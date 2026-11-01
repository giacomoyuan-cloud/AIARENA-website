(function(){
  'use strict';
  function apply(){
    var dark=false;try{dark=localStorage.getItem('aa-light-mode')==='0';}catch(_){}
    document.documentElement.dataset.theme=dark?'dark':'light';
    document.documentElement.style.colorScheme=dark?'dark':'light';
    var meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.content=dark?'#262624':'#faf9f5';
  }
  apply();window.addEventListener('storage',function(event){if(event.key==='aa-light-mode')apply();});
})();
