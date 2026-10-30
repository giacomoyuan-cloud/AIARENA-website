import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {parse,xml,rtf,chart} from './arena-document-parser.mjs';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6O3sAAAAASUVORK5CYII=';
test('Word table units and embedded images survive indexing together',async()=>{
 const zip=new JSZip();zip.file('word/document.xml','<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>DM6 产品</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>额定功率</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>36 W</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>');zip.file('word/media/image1.png',png,{base64:true});
 const file=new File([await zip.generateAsync({type:'uint8array'})],'manual.docx'),coverage={},seen=[],parts=[];
 for await(const s of parse(file,coverage,{ocr:async task=>{seen.push(task);return {kind:'text',text:'白色产品，接口位于右侧，图中文字 450 mL。'};}}))parts.push(s);
 assert.equal(seen.length,1);assert.equal(seen[0].mime,'image/png');assert.ok(!('load'in seen[0]));assert.match(parts.map(s=>s.text).join('\n'),/额定功率.*36 W/s);assert.match(parts.at(-1).text,/450 mL/);assert.equal(coverage.emptyUnits,0);assert.equal(coverage.visualComplete,true);
});
test('direct images become readable visual material and failures remain incomplete',async()=>{
 const file=new File([Buffer.from(png,'base64')],'product.png'),coverage={},parts=[];
 for await(const s of parse(file,coverage,{ocr:async()=>({kind:'text',text:'铭牌：36 W；450 mL。'})}))parts.push(s);
 assert.equal(parts.length,1);assert.equal(coverage.ocrPages,1);assert.match(parts[0].location,/图片 1/);
 const failed={};for await(const s of parse(file,failed,{ocr:async()=>{throw Error('network interrupted');}})){}
 assert.equal(failed.emptyUnits,1);assert.equal(failed.visualComplete,false);assert.match(failed.ocrError,/interrupted/);
});
test('RTF Unicode and table cells are decoded without execution',()=>{
 const b=String.fromCharCode(92),value=rtf('{'+b+'rtf1'+b+'ansi'+b+'uc1 '+b+'u20013?文'+b+'par 功率'+b+'cell 36 W'+b+'cell'+b+'row 容量'+b+'cell 450 mL'+b+'cell'+b+'row}');
 assert.match(value.text,/中文/);assert.match(value.text,/功率\t36 W/);
});
test('EPUB spine order is retained and embedded images are recognized',async()=>{
 const z=new JSZip();z.file('META-INF/container.xml','<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>');z.file('OPS/book.opf','<package><manifest><item id="b" href="b.xhtml"/><item id="a" href="a.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>');z.file('OPS/a.xhtml','<html><body><p>FIRST 36 W</p></body></html>');z.file('OPS/b.xhtml','<html><body><p>LAST 450 mL</p></body></html>');z.file('OPS/img.png',png,{base64:true});const c={},parts=[];
 for await(const s of parse(new File([await z.generateAsync({type:'uint8array'})],'book.epub'),c,{ocr:async()=>({kind:'text',text:'内嵌产品图'})}))parts.push(s);
 assert.match(parts[0].text,/FIRST/);assert.match(parts[1].text,/LAST/);assert.equal(c.ocrPages,1);
});
test('chart series retain category labels and numerical values',()=>{
 const v=chart(xml('<c:chart xmlns:c="urn:c"><c:ser><c:tx><c:v>功率</c:v></c:tx><c:cat><c:pt idx="0"><c:v>DM6</c:v></c:pt></c:cat><c:val><c:pt idx="0"><c:v>36</c:v></c:pt></c:val></c:ser></c:chart>'));assert.match(v,/DM6/);assert.match(v,/"36"/);assert.throws(()=>xml('<r>&notAnEntity;</r>'));
});
