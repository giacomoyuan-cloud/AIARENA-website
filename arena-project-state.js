/* Account-scoped project actions. A late list must not undo a completed action. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./arena-controls.js'));
  else root.ArenaProjectState=factory(root.ArenaControls);
})(typeof globalThis!=='undefined'?globalThis:this,function(controls){
  'use strict';
  function create(options){
    var accounts=new Map();
    function account(){
      var key=options.accountKey(),state=accounts.get(key);
      if(!state){state={key:key,views:{active:[],archived:[],deleted:[]},reads:{},pinReads:{},changes:new Map(),generations:new Map(),pending:new Set()};accounts.set(key,state);}
      return state;
    }
    function emit(state){if(state.key===options.accountKey()&&options.onChange)options.onChange();}
    function pinKey(state,id){return state.key+'|'+id+'|'+(state.generations.get(id)||0);}
    function viewOf(project){return project.deletedAt?'deleted':project.archivedAt?'archived':'active';}
    var pins=controls.createPinStore({
      write:async function(context,value){
        if(pinKey(context.state,context.id)!==context.key)throw Error('项目状态已变化，请重试');
        var data=await options.api('pin',Object.assign({projectId:context.id,pinned:value},context.auth));
        if(!data||data.ok!==true||data.pinned!==value)throw Error(data&&data.error||'置顶保存失败，请重试');
      },
      onChange:function(key,value,pending,context){if(pinKey(context.state,context.id)===context.key)emit(context.state);},
      onError:function(error,context){if(context.state.key===options.accountKey()&&pinKey(context.state,context.id)===context.key&&options.onError)options.onError(error);}
    });
    function projects(state,view){
      var rows=new Map();
      state.views[view].forEach(function(project){
        var change=state.changes.get(project.id);
        // A genuinely newer server edit (for example on another device) wins.
        if(change&&project.updatedAt>change.updatedAt){state.changes.delete(project.id);change=null;}
        var item=change||project;if(viewOf(item)===view)rows.set(item.id,item);
      });
      state.changes.forEach(function(project){if(viewOf(project)===view)rows.set(project.id,project);else rows.delete(project.id);});
      return Array.from(rows.values()).map(function(project){
        var key=pinKey(state,project.id);
        return Object.assign({},project,{pinned:view==='active'?pins.read(key,project.pinned,state.pinReads[view]||0):!!project.pinned,pinPending:pins.pending(key)});
      });
    }
    return {
      projects:function(view){return projects(account(),view||'active');},
      load:async function(view){
        view=view||'active';var state=account(),credentials=options.credentials(),revision=(state.reads[view]||0)+1,pinVersion=pins.version();state.reads[view]=revision;
        var result=await options.api('list',Object.assign({includeArchived:view==='archived',includeDeleted:view==='deleted'},credentials));
        if(!result||!Array.isArray(result.projects))throw Error('项目列表加载失败，请重试');
        if(state.reads[view]===revision){state.views[view]=result.projects;state.pinReads[view]=pinVersion;}
        return projects(state,view);
      },
      togglePin:function(id){
        var state=account(),project=projects(state,'active').find(function(p){return p.id===id;});
        if(!project)throw Error('项目不存在或状态已变化，请刷新后重试');
        var key=pinKey(state,id);return pins.toggle(key,project.pinned,{state:state,key:key,id:id,auth:options.credentials()});
      },
      change:async function(action,project){
        var state=account(),credentials=options.credentials(),id=project.id;
        if(state.pending.has(id))throw Error('项目操作正在保存，请稍候');
        state.pending.add(id);
        try{
          var apiAction=action==='restoreArchive'?'archive':action;
          var data=await options.api(apiAction,Object.assign({projectId:id},action==='restoreArchive'?{archived:false}:{},credentials));
          if(!data||!data.project||data.project.id!==id)throw Error(data&&data.error||'项目操作失败，请重试');
          var updated=data.project,expected=action==='delete'?'deleted':action==='archive'?'archived':'active';
          if(viewOf(updated)!==expected)throw Error('项目状态已变化，请刷新后重试');
          var before=projects(state,viewOf(project)).find(function(p){return p.id===id;})||project;
          updated=Object.assign({},updated,{pinned:action==='delete'||action==='restore'?false:before.pinned});
          if(action==='delete'||action==='restore')state.generations.set(id,(state.generations.get(id)||0)+1);
          state.changes.set(id,updated);emit(state);return updated;
        }finally{state.pending.delete(id);}
      }
    };
  }
  return {create:create};
});
