const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const A=require('./arena-image.js');
const Editor=require('./arena-image-editor.js');
const source=readFileSync(require('node:path').join(__dirname,'index.html'),'utf8');
function fn(name){const f=source.match(new RegExp('  function '+name+'\\([^]*?\\n  }'));assert.ok(f,name);return f[0];}

test('OpenAI controls preserve independent per-model choices and the native outgoing schema',()=>{
  for(const model of A.OPENAI_MODELS){
    const opts=A.requestOptions(model,'edit',{size:'custom',customWidth:1536,customHeight:864,quality:'max',format:'webp',compression:71,background:'transparent',moderation:'low',partial:3,count:2},[{data:'ref',mime:'image/png'}],[{role:'user',parts:[{text:'earlier'}]}]);
    assert.equal(opts.size,'1536x864');assert.equal(opts.quality,'max');assert.equal(opts.n,2);assert.equal(opts.outputFormat,'webp');assert.equal(opts.outputCompression,71);assert.equal(opts.partialImages,3);
    assert.equal(opts.resolution,undefined);assert.equal(opts.aspectRatio,undefined);assert.equal(opts.thinkingLevel,undefined);assert.ok(opts.imageHistory);
    assert.equal(A.normalize(model,{format:'jpeg',background:'transparent'}).format,'png');
    assert.equal(A.requestOptions(model,'generation',{format:'png'},[]).outputCompression,undefined);
  }
  const c=vm.createContext({ArenaImage:A,imageComposerModel:A.OPENAI_MODELS[0],openAIImageSettings:{[A.OPENAI_MODELS[0]]:{quality:'max',format:'webp'},[A.OPENAI_MODELS[1]]:{quality:'low',format:'jpeg'}}});
  vm.runInContext(fn('imageSettingsState')+'\n'+fn('normalizeImageSettings'),c);
  c.normalizeImageSettings();assert.equal(c.imageSettingsState().quality,'max');c.imageComposerModel=A.OPENAI_MODELS[1];c.normalizeImageSettings();assert.equal(c.imageSettingsState().quality,'low');
});

test('custom output sizes enforce the actual OpenAI pixel and aspect limits',()=>{
  for(const size of ['auto','1024x1024','1536x864','864x1536','2048x2048','3840x2160','2160x3840'])assert.equal(A.validSize(size),true,size);
  for(const size of ['1025x1024','4096x2160','3840x3840','3840x1024','512x512','0x1024','NaNx1024','1024:1024'])assert.equal(A.validSize(size),false,size);
});

test('resolution cards show the actual frame proportions without checkmarks',()=>{
  for(const size of ['1024x1024','1536x1024','1024x1536','2048x1152','1152x2048','3840x2160']){
    const info=A.sizeInfo(size),[w,h]=size.split('x').map(Number);
    assert.ok(Math.abs(info.width/info.height-w/h)<.002,size);
    const html=A.sizeChoice(size,size,{});assert.ok(html.includes(info.resolution));assert.ok(html.includes('arena-size-paper'));
    assert.doesNotMatch(html,/m5 12 4 4L19 6|arena-image-pop-check/);
  }
  assert.equal(A.sizeInfo('1024x1024').ratio,'1:1');assert.equal(A.sizeInfo('1536x1024').ratio,'3:2');
});

test('custom frame preview follows width and height immediately, including portrait and incomplete drafts',()=>{
  const state={size:'custom',customWidth:1536,customHeight:864};
  assert.ok(A.customSizePreview(state).includes('16:9 横幅'));
  state.customWidth=864;state.customHeight=1536;assert.ok(A.customSizePreview(state).includes('9:16 竖幅'));
  state.customWidth=1024;state.customHeight=1024;assert.ok(A.customSizePreview(state).includes('1:1 方形'));
  state.customWidth=0;assert.ok(A.customSizePreview(state).includes('输入宽度和高度'));
  assert.ok(source.includes("$('aaImageSettingsPop').addEventListener('input'"),'custom preview is updated before blur/change');
});

test('OpenAI uploads preserve original resolution, alpha and MIME instead of converting every photo to JPEG',()=>{
  const original='data:image/png;base64,cG5nLW9yaWdpbmFs';let rendered=0;
  class Reader{readAsDataURL(){this.onload({target:{result:original}});}}
  class Image{set src(_value){this.width=4000;this.height=3000;this.onload();}}
  const c=vm.createContext({ArenaImage:A,imageMode:true,imageComposerModel:A.OPENAI_MODELS[0],sentImgs:[],aaRunning:false,FileReader:Reader,Image,
    imageReferenceLimit:()=>16,setImageError:()=>{},renderImgPreviews:()=>rendered++,alert:()=>assert.fail('unexpected alert'),document:{createElement:()=>assert.fail('must not resize/re-encode this reference')}});
  vm.runInContext(fn('handleImageFile'),c);c.handleImageFile({size:100000,type:'image/png'});
  assert.equal(c.sentImgs[0].data,'cG5nLW9yaWdpbmFs');assert.equal(c.sentImgs[0].mime,'image/png');assert.equal(rendered,1);
});

test('image history retains previous instructions and only stores one copy of each generated image',()=>{
  const image={data:'final-image',mime:'image/webp'};
  const c=vm.createContext({msgs:[{uid:1,submodel:A.OPENAI_MODELS[0],text:'',imgItems:[image],imgData:image.data,imgMime:image.mime,
    imageTurn:{prompt:'Keep the product unchanged',parentUid:null,references:[]},imageResponse:[{imageIndex:0}],imageDetails:[{quality:'high',format:'webp'}],imageSettings:{format:'webp'},_imagePreview:{data:'temporary-preview'}}]});
  vm.runInContext(fn('serializeMsgs'),c);const saved=JSON.parse(JSON.stringify(c.serializeMsgs()));
  assert.equal(saved[0]._imagePreview,undefined);assert.equal(saved[0].imgData,undefined);assert.equal(saved[0].imgItems[0].data,image.data);
  assert.equal(saved[0].imageDetails[0].quality,'high');assert.equal(saved[0].imageSettings.format,'webp');
  const history=A.historyFor(saved,1);assert.equal(history[0].parts[0].text,'Keep the product unchanged');assert.equal(history[1].parts[0].inlineData.data,image.data);
});

test('mask brush coordinates stay on the image as its display size changes',()=>{
  assert.deepEqual(Editor.point(350,250,{left:100,top:50,width:500,height:400}),{x:.5,y:.5});
  assert.deepEqual(Editor.point(-5,900,{left:0,top:0,width:500,height:400}),{x:0,y:1});
  const commands=[],context={beginPath(){},moveTo(x,y){commands.push(['start',x,y]);},lineTo(x,y){commands.push(['line',x,y]);},stroke(){},fillRect(){}};
  Editor.drawPaths(context,[{size:.1,points:[{x:.5,y:.5},{x:1,y:1}]}],1024,768);
  assert.equal(context.lineWidth,102.4);assert.deepEqual(commands,[['start',512,384],['line',1024,768]]);
});

test('preview UI never offers download or edit actions and escapes provider-supplied detail text',()=>{
  const c=vm.createContext({esc:text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))});
  vm.runInContext(fn('renderOpenAIImagePreview')+'\n'+fn('renderOpenAIImageDetails'),c);
  const html=c.renderOpenAIImagePreview({data:'aGVsbG8=',mime:'image/png',batchIndex:0},false);
  assert.match(html,/过程预览/);assert.doesNotMatch(html,/button|download|编辑这张/);
  const details=c.renderOpenAIImageDetails({revisedPrompt:'<img src=x onerror=alert(1)>',quality:'high',format:'webp'});
  assert.ok(details.includes('&lt;img'));assert.doesNotMatch(details,/<img/);
});
