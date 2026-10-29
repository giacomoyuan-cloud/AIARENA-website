// Haiku 5.5 thinks by default. These bounded utility tasks keep thinking off.
export const AUXILIARY_MODEL='claude-haiku-5-5';
export const AUXILIARY_SETTINGS=Object.freeze({
  model:AUXILIARY_MODEL,
  service_tier:'standard_only',
  thinking:Object.freeze({type:'disabled'}),
  output_config:Object.freeze({effort:'low'})
});
export function auxiliaryText(data){
  if(data?.stop_reason==='refusal')throw Error('辅助任务被官方模型拒绝');
  const text=(Array.isArray(data?.content)?data.content:[]).filter(block=>block.type==='text'&&typeof block.text==='string').map(block=>block.text).join('\n').trim();
  if(!text)throw Error('辅助任务未返回有效文本');
  return text;
}
