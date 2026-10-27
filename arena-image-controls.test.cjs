const test=require('node:test');
const assert=require('node:assert/strict');
const A=require('./arena-image.js');

test('ratio examples preserve portrait, landscape and decimal proportions',()=>{
  for(const c of Object.values(A.capabilities))for(const ratio of c.ratios){
    const r=A.ratioInfo(ratio);
    if(ratio==='auto'){assert.equal(r.orientation,'随内容');continue;}
    const [w,h]=ratio.split(':').map(Number);
    assert.ok(Math.abs(r.width/r.height-w/h)<.01,ratio+' example must have the requested proportions');
    assert.equal(r.orientation,w===h?'方形':w>h?'横幅':'竖幅');
  }
  assert.ok(A.ratioInfo('2:3').height>A.ratioInfo('2:3').width);
  assert.ok(A.ratioInfo('3:2').width>A.ratioInfo('3:2').height);
});

test('custom image controls expose only each model’s supported parameter values',()=>{
  for(const [model,c] of Object.entries(A.capabilities)){
    const html=A.settingsMarkup(model,'generation',{},[{value:'none',label:'无预设'},{value:'photo',label:'写实摄影'}]);
    assert.doesNotMatch(html,/<select\b/,'image settings do not open native OS select menus');
    const values={};
    for(const [,key,value] of html.matchAll(/data-image-setting="([^"]+)" value="([^"]+)"/g))(values[key]||=[]).push(value);
    assert.deepEqual(values.ratio,c.ratios);assert.deepEqual(values.size,c.sizes);
    if(c.thinking){
      assert.deepEqual(values.thinking,c.thinking);assert.deepEqual(values.grounding,['off','web','image','web-image']);
      assert.deepEqual(values.imageOnly,['true','false']);assert.match(html,/画面内的文字/);
    }else{
      assert.deepEqual(values.quality,c.quality);assert.deepEqual(values.count,['1','2','3','4']);
      assert.equal(values.grounding,undefined);assert.equal(values.imageOnly,undefined);
      assert.doesNotMatch(A.settingsMarkup(model,'edit',{}),/data-image-setting="count"/);
    }
  }
});
