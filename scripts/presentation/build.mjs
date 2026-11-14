import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {Presentation,PresentationFile} from '@oai/artifact-tool';
const root=path.resolve(process.argv[2]);const skill=process.env.IELTS_PRESENTATION_SKILL;
const build=path.join(root,'local-data/demo-deck');const final=path.join(root,'docs/presentation/Group20.pptx');
const data=JSON.parse(await fs.readFile(path.join(root,'docs/presentation/slides.json'),'utf8'));
const deck=Presentation.create({slideSize:{width:1280,height:720}});
const C={ink:'#153D32',muted:'#52675F',paper:'#F5F7F2',orange:'#E36C37',cream:'#F4F4E9',dark:'#10382D',red:'#B84335'};
function tx(s,name,value,x,y,w,h,size=28,color=C.ink,bold=false){const a=s.shapes.add({name,geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',style:'solid',width:0}});a.text=value;a.text.style={fontFamily:'Arial',fontSize:size,color,bold};return a;}
function title(s,row,dark=false){tx(s,'title',row.title,62,36,1155,76,44,dark?C.cream:C.ink,true);tx(s,'context',row.subtitle,65,119,1148,66,25,dark?'#C5D8CC':C.muted);}
function foot(s,row,dark=false){const note=row.assets.length?'Translated local capture - English labels for presentation; click image for the live page.':'Group 20 - synthetic local demonstration';tx(s,'provenance',note,66,678,1110,28,16,dark?'#C5D8CC':C.muted);tx(s,'page',String(row.slide),1198,678,40,25,16,dark?C.cream:C.muted);}
function route(asset){if(asset.startsWith('profile'))return'/profile';if(asset.startsWith('plan')||asset.startsWith('task'))return'/plan';if(asset.startsWith('word'))return'/vocabulary';if(asset.startsWith('reading'))return'/question-bank?module=reading';if(asset.startsWith('writing'))return'/writing';if(asset==='overview')return'/';return'/resources';}
async function image(s,name,x,y,w,h,crop){const bytes=await fs.readFile(path.join(root,'docs/presentation/assets/demo',name+'.png'));let iw=bytes.readUInt32BE(16),ih=bytes.readUInt32BE(20);if(crop){iw*=1-crop.left-crop.right;ih*=1-crop.top-crop.bottom;}const r=Math.min(w/iw,h/ih);return s.images.add({blob:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),contentType:'image/png',alt:'Actual offline application capture with English presentation labels: '+name,fit:'contain',position:{left:x+(w-iw*r)/2,top:y+(h-ih*r)/2,width:iw*r,height:ih*r},...(crop?{crop}:{}),hyperlink:{uri:'http://127.0.0.1:3000'+route(name),isExternal:true}});}
for(const row of data){const s=deck.slides.add();const dark=['cover','verification','qa'].includes(row.layout);s.background.fill=dark?C.dark:C.paper;title(s,row,dark);
 switch(row.layout){
 case'cover':
  // The product name is the only large cover heading.
  for(const shape of s.shapes.items)shape.delete();
  tx(s,'cover-label','GUIDED PRODUCT DEMONSTRATION',74,70,1100,45,23,'#C5D8CC');
  tx(s,'cover-title','IELTS\nAdaptive Coach',70,173,1100,230,82,C.cream,true);
  tx(s,'cover-subtitle','Practice, personal memory and inspectable evidence',76,458,1100,98,33,C.cream);
  tx(s,'group','Group 20  |  15-minute demonstration + Q&A',76,606,1100,45,25,'#C5D8CC');break;
 case'case':
  tx(s,'learner','Alex',72,225,440,73,60,C.ink,true);tx(s,'input-band','5.5 to 7.0',75,320,440,74,54,C.orange,true);tx(s,'band-scope','Current input and target\nNot a predicted score',77,416,410,98,28,C.muted);tx(s,'deadline','Exam in 30 days',77,558,410,55,31,C.ink,true);await image(s,'profile-targets',540,190,655,465);break;
 case'tour':
  tx(s,'goal','A visible goal',70,220,305,55,32,C.ink,true);tx(s,'goal-text','The target stays in view.',72,275,300,70,26,C.muted);tx(s,'status','A task status',70,390,305,55,32,C.ink,true);tx(s,'status-text','10% = 1 of 10 tasks\nmarked complete.',72,445,310,90,26,C.muted);tx(s,'actions','Linked practice pages',70,574,320,70,29,C.orange,true);await image(s,'overview',410,185,830,470);break;
 case'architecture':{
  const values=[['Component','Role in this demonstration'],['Next.js','Interactive learning pages and shared navigation'],['FastAPI','Authentication, business routes and 62 API method/path pairs'],['SQLite','Profiles, practice facts, documents and personal knowledge'],['LangGraph + OR-Tools','Recorded workflow execution and constrained scheduling'],['Retrieval + model adapter','Keyword / hashing evidence retrieval; explicit offline fallback']];
  const t=s.tables.add({rows:values.length,columns:2,left:70,top:200,width:1140,height:428,columnWidths:[300,840],values});
  t.borders.assign({fill:'#D6E1D8',width:1,style:'solid'});
  for(let r=0;r<values.length;r++)for(let c=0;c<2;c++){const cell=t.getCell(r,c);cell.fill=r===0?C.ink:(r%2?'#FFFFFF':'#EAF0E9');cell.text.style={fontFamily:'Arial',fontSize:r===0?26:24,bold:r===0||c===0,color:r===0?'#FFFFFF':C.ink};}
  break;}
 case'time':
  tx(s,'daily','90',76,217,440,100,86,C.orange,true);tx(s,'daily-label','minutes per day',82,323,450,52,34,C.ink,true);tx(s,'weekly','630',76,413,440,100,86,C.ink,true);tx(s,'weekly-label','available minutes this week',82,523,455,80,28,C.muted);await image(s,'profile-minutes',650,178,490,480);break;
 case'reading':
  tx(s,'question-label','The passage says:',76,224,510,48,27,C.muted);tx(s,'passage-quote','"Planting programmes do not produce identical results everywhere."',74,290,535,183,36,C.ink,true);tx(s,'answer','Your answer: True\nReference: False',77,514,500,109,31,C.red,true);await image(s,'reading-feedback',687,176,520,481);break;
 case'memory':
  tx(s,'fact','1 error event',74,227,355,65,44,C.orange,true);tx(s,'fact-label','Recorded by an actual\nsynthetic question attempt',76,308,335,115,27,C.muted);tx(s,'fragment','1 manual note',74,460,355,65,39,C.ink,true);tx(s,'fragment-label','A separate fragment about\nlogical connections',76,537,340,98,26,C.muted);await image(s,'memory-cards',441,193,790,450);break;
 case'retrieval':
  tx(s,'query-label','QUERY',74,219,300,35,22,C.orange,true);tx(s,'query','however supporting evidence',74,266,1120,55,39,C.ink,true);
  await image(s,'retrieval-first',70,359,1140,190);
  tx(s,'inspection','A personal note can be opened, read and traced back to its source.',76,583,1130,70,30,C.ink);break;
 case'pdf':
  await image(s,'pdf-page-two',70,206,1140,300);
  tx(s,'page-number-proof','Page 2 retained',76,539,550,62,41,C.orange,true);tx(s,'ownership-proof','Authenticated original file',650,544,550,88,32,C.ink,true);break;
 case'draft':
  await image(s,'plan-draft-summary',70,202,1140,167);
  tx(s,'draft-observe','Observe the draft status and the approval action.',76,405,1130,60,33,C.ink,true);
  tx(s,'plan-output','10 tasks / 320 minutes',76,505,1120,74,50,C.orange,true);
  tx(s,'constraints','Daily capacity, workload and the pre-exam horizon remain hard constraints.',78,602,1110,57,26,C.muted);break;
 case'approval':
  await image(s,'plan-active-summary',70,196,1140,157);
  await image(s,'task-completed',83,383,233,263);
  tx(s,'approved-state','APPROVED',380,402,790,68,51,C.orange,true);tx(s,'done-state','1 task marked complete',382,491,790,59,36,C.ink,true);tx(s,'restore','Restore remains available for a mistaken completion.',384,575,790,70,27,C.muted);break;
 case'vocabulary':
  tx(s,'recall','01  RECALL',73,209,540,45,29,C.ink,true);tx(s,'reveal','02  REVEAL + REVIEW',670,209,540,45,29,C.orange,true);
  await image(s,'word-recall',65,275,548,325);await image(s,'word-reveal',663,275,548,325);
  tx(s,'dictionary','8,520 pinned ECDICT entries; no generation call is needed to reveal a card.',73,621,1140,44,24,C.muted);break;
 case'writing-v1':
  await image(s,'writing-v1',55,184,548,473);
  tx(s,'draft-quote','"However, it helps students get jobs."',650,211,550,155,38,C.ink,true);
  tx(s,'feedback','Both reasons support the same claim; the contrast is unsupported.',650,378,548,110,29,C.muted);
  tx(s,'hint-label','A progressive hint',650,507,540,44,26,C.orange,true);
  await image(s,'writing-hint',645,550,548,105,{left:0.58,top:0.855,right:0.02,bottom:0.015});break;
 case'writing-v2':
  tx(s,'improved','IMPROVED',75,216,510,39,23,C.orange,true);
  tx(s,'revision-quote','"For example, a student who cannot afford tuition could train as a teacher..."',73,273,522,213,35,C.ink,true);
  tx(s,'remaining','Still to explain:',75,515,510,41,27,C.orange,true);
  tx(s,'remaining-detail','Why support is narrower than\n"everyone" in the prompt.',75,565,522,84,27,C.muted);
  await image(s,'writing-v2',650,182,565,474);break;
 case'assistant':
  tx(s,'mode','OFFLINE',74,222,530,79,61,C.orange,true);
  tx(s,'fallback','Retrieved sources remain\navailable for inspection.',75,333,550,132,37,C.ink,true);
  tx(s,'honest-output','No new model answer is invented\nwhen generation is unavailable.',77,511,556,95,29,C.muted);
  await image(s,'assistant-sources',737,167,460,492);break;
 case'verification':
  for(const [i,value,label]of [[0,'152','backend tests'],[1,'20','browser flows'],[2,'62','API method/path pairs']]){const x=75+i*405;tx(s,'metric-'+i,value,x,261,360,115,93,i===1?'#FFB074':C.cream,true);tx(s,'metric-label-'+i,label,x+3,391,360,86,29,C.cream);}
  tx(s,'test-composition','Browser coverage: 14 mocked-interface flows + 6 real offline API flows',79,537,1120,61,29,'#C5D8CC');tx(s,'quality-scope','These checks do not measure real model quality or learner score gains.',80,611,1110,43,23,'#C5D8CC');break;
 case'boundaries':
  tx(s,'working','WORKING IN THIS RUN',72,217,550,49,29,C.ink,true);tx(s,'working-detail','Interactive practice\nPersonal memory and source access\nPlanning and explicit approval',75,300,530,200,31,C.ink);
  tx(s,'pending','NEXT VALIDATION',674,217,540,49,29,C.orange,true);tx(s,'pending-detail','Real generation and semantic retrieval\nHuman-reviewed evaluation data\nDeployment and compatible legacy integration',676,300,535,233,29,C.muted);
  tx(s,'live-link','Live pages: http://127.0.0.1:3000',76,595,1120,55,31,C.ink,true);break;
 case'qa':
  tx(s,'qa-main','Your questions',77,245,1120,100,70,C.cream,true);tx(s,'qa-topics','Personal memory and RAG\nCalendar constraints and approval\nEvidence, limitations and next steps',82,389,1100,202,34,'#C5D8CC');break;
 }
 foot(s,row,dark);
 s.speakerNotes.text=`成员：${row.presenter}；时长：${row.seconds}秒。\n\n${row.notes_zh}\n\n证据：${row.sources}\n\n素材：${row.assets.join(', ')}。截图用当前离线服务与合成账号实际操作采集；仅将可见中文标签和解释翻译为英文，没有生成新的模型反馈、改分或伪造来源。写作V1/V2为独立固定示例，与Alex新笔记没有实时生成关系。截图链接打开本地页面，需先启动服务并登录，浏览器数据可不同。`;
}
await fs.mkdir(path.join(build,'previews'),{recursive:true});const candidate=path.join(build,'demo-candidate.pptx');await(await PresentationFile.exportPptx(deck)).save(candidate);console.log('Exported demonstration draft',data.length);
execFileSync('D:\\Anaconda3\\envs\\ielts-coach\\python.exe',[path.join(root,'scripts/presentation/attach-links.py'),candidate],{stdio:'inherit',env:{...process.env,PYTHONNOUSERSITE:'1',PYTHONUTF8:'1'}});
for(let i=0;i<deck.slides.items.length;i++){const png=await deck.export({slide:deck.slides.items[i],format:'png',scale:1});await fs.writeFile(path.join(build,'previews',`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await png.arrayBuffer()));console.log('Rendered',i+1);}
const{finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
const report=await finalizePresentation({workspaceDir:root,candidatePath:candidate,finalPath:final,pythonExecutable:'D:\\Anaconda3\\envs\\ielts-coach\\python.exe',integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit','--validate-bullet-geometry','--require-native-table-slide','4'],explicitTotalSlideCount:18,requiredNativeTableOwnerSlides:[4],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:['Arial']},verifyArtifactToolImport:true,receiptPath:path.join(build,'demo-final-validation.json')});
await fs.writeFile(path.join(build,'demo-finalizer-result.json'),JSON.stringify(report,null,2));console.log('Final demonstration deck:',final);
