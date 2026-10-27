(function(root){
  'use strict';
  function mount(options){
    var image=options.image,input=options.input,welcome=options.welcome;
    var doc=options.document||image.ownerDocument;
    var media=options.media||(root.matchMedia?root.matchMedia('(prefers-reduced-motion: reduce)'):null);
    var animation=image.getAttribute('data-animation'),poster=image.getAttribute('data-poster');
    function update(){
      var drafting=!!input.value.trim();
      var play=options.active()&&!drafting&&!doc.hidden&&!(media&&media.matches);
      var state=play?'playing':'paused',src=play?animation:poster;
      if(welcome.getAttribute('data-drafting')!==String(drafting))welcome.setAttribute('data-drafting',String(drafting));
      if(welcome.getAttribute('data-animation-state')!==state)welcome.setAttribute('data-animation-state',state);
      if(image.getAttribute('src')!==src)image.setAttribute('src',src);
    }
    input.addEventListener('input',update);
    input.addEventListener('focus',update);
    doc.addEventListener('visibilitychange',update);
    if(media){if(media.addEventListener)media.addEventListener('change',update);else if(media.addListener)media.addListener(update);}
    update();
    return {update:update,destroy:function(){
      input.removeEventListener('input',update);input.removeEventListener('focus',update);doc.removeEventListener('visibilitychange',update);
      if(media){if(media.removeEventListener)media.removeEventListener('change',update);else if(media.removeListener)media.removeListener(update);}
      image.setAttribute('src',poster);welcome.setAttribute('data-animation-state','paused');
    }};
  }
  var api=Object.freeze({mount:mount});root.ArenaWelcome=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
