import {renderToString} from 'katex';
// A fresh macro scope per expression prevents one reply from altering another.
export function render(source, displayMode=false) {
  if(!source || source.length>10000)return null;
  try {
    return renderToString(source,{displayMode,throwOnError:true,trust:false,strict:'error',maxSize:10,maxExpand:1000,macros:{},output:'htmlAndMathml'});
  } catch { return null; }
}
