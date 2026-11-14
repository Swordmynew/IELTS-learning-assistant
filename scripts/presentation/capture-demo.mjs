import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();const require=createRequire(path.join(root,'frontend/package.json'));
const {chromium,request}=require('@playwright/test');
const out=path.join(root,'docs/presentation/assets/demo');
const dictionary=JSON.parse(await fs.readFile(path.join(root,'scripts/presentation/ui-translation.json'),'utf8'));
const api=await request.newContext({baseURL:'http://127.0.0.1:8000'});
const reg=await api.post('/api/v1/auth/register',{data:{email:`demo-deck-${crypto.randomUUID()}@example.com`,password:'SyntheticPresentation123',display_name:'Alex'}});
if(reg.status()!==201)throw new Error('Synthetic account setup failed '+reg.status());
const token=(await reg.json()).access_token;const headers={Authorization:`Bearer ${token}`};
const today=new Date();today.setDate(today.getDate()+30);const exam=today.toISOString().slice(0,10);
const prof=await api.post('/api/v1/diagnostics',{headers,data:{exam_date:exam,current_scores:{reading:5.5,writing:5.5,listening:5.5,speaking:5.5},target_scores:{reading:7,writing:7,listening:7,speaking:7},minutes_by_weekday:Object.fromEntries([1,2,3,4,5,6,7].map(x=>[x,90])),preferred_skills:['writing'],estimates:[]}});
if(prof.status()!==200)throw new Error('Profile setup failed');
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1500,height:1000},deviceScaleFactor:1,locale:'en-US'});
await context.addInitScript(token=>localStorage.setItem('ielts-access-token',token),token);
const page=await context.newPage();const records=[];const missed=new Set();
async function snap(name,locator=page){
 await page.evaluate(()=>document.fonts.ready);
 const original=await page.evaluate(()=>{
  const nodes=[];const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;
  while(n=w.nextNode()){if(/[\u3400-\u9fff]/.test(n.nodeValue||'') && n.parentElement?.getBoundingClientRect().height>0 && n.parentElement.getBoundingClientRect().top<innerHeight && n.parentElement.getBoundingClientRect().bottom>0 && getComputedStyle(n.parentElement).visibility!=='hidden' && !['SCRIPT','STYLE'].includes(n.parentElement.tagName))nodes.push(n.nodeValue);}
  return [...new Set(nodes)];
 });
 const result=await page.evaluate(dict=>{
  const saved=[];const miss=[];
  const translate=value=>{
   let t=value;const trim=t.trim();if(dict[trim])return t.replace(trim,dict[trim]);
   t=t.replace(/(\d+)月(\d+)日周([一二三四五六日])/g,(_,m,d,w)=>`${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m]} ${d} ${({'一':'Mon','二':'Tue','三':'Wed','四':'Thu','五':'Fri','六':'Sat','日':'Sun'})[w]}`);
   const ordered=Object.keys(dict).sort((a,b)=>b.length-a.length);for(const k of ordered)t=t.split(k).join(dict[k]);return t;
  };
  const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;
  while(n=w.nextNode())if(/[\u3400-\u9fff]/.test(n.nodeValue||'') && !['SCRIPT','STYLE'].includes(n.parentElement?.tagName)){
   const before=n.nodeValue;const after=translate(before);saved.push({n,before});n.nodeValue=after;
   if(/[\u3400-\u9fff]/.test(after)&&n.parentElement?.getBoundingClientRect().height>0&&n.parentElement.getBoundingClientRect().top<innerHeight&&n.parentElement.getBoundingClientRect().bottom>0&&getComputedStyle(n.parentElement).visibility!=='hidden')miss.push(before.trim());
  }
  const attrs=[];for(const element of document.querySelectorAll('[placeholder]')){const value=element.getAttribute('placeholder');if(/[\u3400-\u9fff]/.test(value)){attrs.push({element,value});element.setAttribute('placeholder',translate(value));}}
  const optionAttrs=[];for(const element of document.querySelectorAll('option')){if(/[\u3400-\u9fff]/.test(element.textContent)){optionAttrs.push({element,value:element.getAttribute('label')});element.label=translate(element.textContent).replace(/第\s*(\d+)\s*页/g,'Page $1');}} window.__demoRestore=()=>{for(const {n,before}of saved)n.nodeValue=before;for(const{element,value}of attrs)element.setAttribute('placeholder',value);for(const{element,value}of optionAttrs){if(value===null)element.removeAttribute('label');else element.setAttribute('label',value);}};
  return miss;
 },dictionary);
 if(name==='memory-cards'){const first=await page.locator('.coach-knowledge-card').first().boundingBox();const last=await page.locator('.coach-knowledge-card').nth(1).boundingBox();await page.screenshot({path:path.join(out,name+'.png'),clip:{x:first.x,y:first.y,width:last.x+last.width-first.x,height:Math.max(first.height,last.height)},animations:'disabled'});}else{await locator.screenshot({path:path.join(out,name+'.png'),animations:'disabled'});}
 await page.evaluate(()=>window.__demoRestore());
 result.forEach(x=>missed.add(x));records.push({asset:name+'.png',route:new URL(page.url()).pathname,translatedVisibleStrings:original.length,untranslated:result});
 console.log('Captured',name,'untranslated',result.length);
}
await page.goto('http://127.0.0.1:3000/profile');await page.getByRole('button',{name:'保存学习档案',exact:true}).waitFor();await snap('profile'); await snap('profile-targets',page.locator('main section').first()); await snap('profile-minutes',page.locator('main section').nth(1));
await page.goto('http://127.0.0.1:3000/plan');await page.getByRole('button',{name:'生成本周计划',exact:true}).click();await page.getByRole('button',{name:'启用计划',exact:true}).waitFor();await snap('plan-draft'); await snap('plan-draft-summary',page.locator('.plan-summary'));
await page.getByRole('button',{name:'启用计划',exact:true}).click();await page.getByText('计划已启用',{exact:true}).waitFor();await page.getByRole('button',{name:'标记完成',exact:true}).first().click();await page.getByRole('button',{name:'恢复任务',exact:true}).waitFor();await snap('plan-approved'); await snap('plan-active-summary',page.locator('.plan-summary')); await snap('task-completed',page.locator('.plan-task.done').first());
await page.goto('http://127.0.0.1:3000/');await page.getByRole('heading',{name:'学习概览',exact:true}).waitFor();await snap('overview');
await page.goto('http://127.0.0.1:3000/vocabulary');await page.getByRole('button',{name:'开始学习',exact:true}).click();await page.getByRole('button',{name:'查看释义',exact:true}).waitFor();await snap('word-recall',page.locator('.word-study'));await page.getByRole('button',{name:'查看释义',exact:true}).click();await snap('word-reveal',page.locator('.word-study'));await page.getByRole('button',{name:'记住了 1 天'}).click();await page.getByRole('button',{name:'关闭复习',exact:true}).click();
await page.goto('http://127.0.0.1:3000/question-bank?module=reading');await page.locator('.question-set > summary').first().click();const question=page.locator('article').filter({has:page.getByRole('heading',{name:'1. Tree-planting programmes have the same cooling effect in every city.',exact:true})});
await page.getByRole('radio',{name:'A True',exact:true}).first().check();await page.getByRole('button',{name:'提交答案',exact:true}).first().click();await page.getByText(/这次还没有答对/).waitFor();await snap('reading-feedback',page.locator('.question-item').first());
await page.goto('http://127.0.0.1:3000/resources');await page.getByRole('button',{name:'新建笔记',exact:true}).click();const editor=page.getByRole('dialog',{name:'新建碎片笔记'});await editor.getByLabel('标题',{exact:true}).fill('However: contrast, not cause');await editor.getByLabel('笔记内容',{exact:true}).fill('Use however for a genuine contrast. Use for example to introduce supporting evidence.');await editor.getByLabel('知识点标签',{exact:true}).fill('Coherence');await editor.getByRole('button',{name:'保存笔记',exact:true}).click();await editor.waitFor({state:'hidden'});await page.getByRole('heading',{name:'However: contrast, not cause',exact:true}).waitFor(); await page.getByRole('button',{name:/^全部\s*2$/}).click(); await page.locator('.coach-knowledge-card').nth(1).waitFor(); await snap('personal-memory'); await snap('memory-cards',page.locator('.coach-knowledge-grid'));
await page.getByText('查找相关资料',{exact:true}).click();await page.getByLabel('查找笔记与错题').fill('however supporting evidence');await page.getByRole('button',{name:'查找',exact:true}).click();await page.locator('.memory-find .coach-sources summary').first().waitFor();await page.locator('.memory-find .coach-sources summary').filter({hasText:'However: contrast, not cause'}).click();await snap('retrieval-evidence'); await snap('retrieval-panel',page.locator('.memory-find')); await snap('retrieval-first',page.locator('.memory-find .coach-sources details').filter({hasText:'However: contrast, not cause'}));
await page.getByRole('button',{name:'资料与笔记',exact:true}).click();await page.getByRole('button',{name:'查看原文',exact:true}).nth(1).click();await page.getByRole('region',{name:'资料原文'}).waitFor();await snap('source-reader',page.getByRole('region',{name:'资料原文'}));
await page.getByRole('button',{name:'关闭资料原文',exact:true}).click();
const streams=['BT /F1 12 Tf 40 700 Td (Page 1: however introduces a contrast.) Tj ET','BT /F1 12 Tf 40 700 Td (Page 2: use for example to introduce supporting evidence.) Tj ET'];
const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',...streams.map(t=>`<< /Length ${Buffer.byteLength(t)} >>\nstream\n${t}\nendstream`),'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((t,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${t}\nendobj\n`;});const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;for(const n of offsets.slice(1))pdf+=`${String(n).padStart(10,'0')} 00000 n \n`;pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await page.locator('.upload-disclosure > summary').click();await page.locator('input[type="file"]').setInputFiles({name:'Demo-source-evidence.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdf)});await page.getByRole('button',{name:'上传',exact:true}).click();
const pdfrow=page.locator('.document-list > article').filter({hasText:'Demo-source-evidence'});await pdfrow.getByRole('button',{name:'查看原文',exact:true}).click();const pdfreader=page.getByRole('region',{name:'资料原文'});await pdfreader.getByRole('combobox',{name:'资料页码'}).selectOption('2');await pdfreader.getByText('Page 2: use for example to introduce supporting evidence.',{exact:true}).waitFor();await snap('pdf-page-two',pdfreader);
await page.goto('http://127.0.0.1:3000/writing');await page.getByRole('button',{name:'离线示例',exact:true}).click();const demo=page.getByRole('dialog',{name:'离线示例'});await demo.getByRole('button',{name:'V1 · 初稿'}).waitFor();await snap('writing-v1',demo);await demo.getByRole('button',{name:'方向',exact:true}).click();await snap('writing-hint',demo);await demo.getByRole('button',{name:'V2 · 修改稿'}).click();await snap('writing-v2',demo);
await page.goto('http://127.0.0.1:3000/resources');await page.getByRole('button',{name:'打开个人学习助手',exact:true}).click();await page.getByRole('textbox',{name:'学习问题',exact:true}).fill('How should I use however when supporting my argument?');await page.getByRole('button',{name:'发送问题',exact:true}).click();await page.getByText(/模型暂不可用/).waitFor();await snap('assistant-sources',page.locator('#learning-assistant'));
await fs.writeFile(path.join(root,'local-data/demo-deck/capture-manifest.json'),JSON.stringify({mode:'offline + hashing',syntheticAccount:true,translatedLabelsForPresentation:true,records,missing:[...missed]},null,2));
await browser.close();await api.dispose();console.log('MISSING',JSON.stringify([...missed])); if(missed.size) process.exitCode=2;
