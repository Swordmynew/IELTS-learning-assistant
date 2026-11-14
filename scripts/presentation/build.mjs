import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';
const root=path.resolve(process.argv[2]);
if (!root || !process.env.IELTS_PRESENTATION_SKILL) throw new Error('Pass project root and IELTs skill path');
const skill=process.env.IELTS_PRESENTATION_SKILL;
const build=path.join(root,'local-data/presentation-build');
const final=path.join(root,'docs/presentation/Group20.pptx');
const data=JSON.parse(await fs.readFile(path.join(root,'docs/presentation/slides.json'),'utf8'));
const presentation=Presentation.create({slideSize:{width:1280,height:720}});
function text(slide,name,value,left,top,width,height,size,color='#173B31',bold=false) {
  const box=slide.shapes.add({name,geometry:'textbox',position:{left,top,width,height},fill:'none',line:{fill:'none',width:0,style:'solid'}});
  box.text=value; box.text.style={fontFamily:'Arial',fontSize:size,color,bold};return box;
}
for (const row of data) {
  for(const value of [row.title,row.subtitle,...row.points.flatMap(p=>[p.label,p.text])]) if (/[\u3400-\u9fff]/.test(value)) throw new Error('Chinese found in displayed slide '+row.slide);
  const slide=presentation.slides.add();
  const dark=row.slide===1 || row.slide===13;
  slide.background.fill=dark?'#123B31':'#F8FAF6';
  const foreground=dark?'#F8FAF6':'#173B31', muted=dark?'#C9D6CD':'#51625A';
  if(row.slide===1) {
    text(slide,'deck-title','IELTS\nAdaptive Coach',88,150,1080,220,78,foreground,true);
    text(slide,'deck-subtitle',row.subtitle,92,405,1070,80,34,muted);
    text(slide,'group','Group 20',92,570,500,48,27,foreground);
  } else {
    text(slide,'slide-title',row.title,80,58,1120,78,48,foreground,true);
    text(slide,'slide-context',row.subtitle,82,154,1100,78,28,muted);
    row.points.forEach((p,i)=> {
      const y=252+i*126;
      text(slide,'point-'+i,p.label,82,y,1110,42,31,foreground,true);
      text(slide,'detail-'+i,p.text,82,y+45,1100,76,27,muted);
    });
  }
  text(slide,'page-number',String(row.slide),1170,664,50,28,17,muted);
  slide.speakerNotes.text=`成员：${row.presenter}；建议时长：${row.seconds}秒。\n\n${row.notes_zh}\n\n证据来源：${row.sources}\n\n语言：展示页英文；这些中文备注仅供演讲者使用。`;
}
await fs.mkdir(path.join(build,'previews'),{recursive:true});
const candidate=path.join(build,'candidate-reviewed.pptx');
await(await PresentationFile.exportPptx(presentation)).save(candidate);
console.log('Draft exported',data.length,'slides');
for (let i=0;i<presentation.slides.items.length;i++) {
 const slide=presentation.slides.items[i];
 const png=await presentation.export({slide,format:'png',scale:1});
 await fs.writeFile(path.join(build,'previews',`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await png.arrayBuffer()));
 console.log('Rendered slide',i+1);
}
const {finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
const result=await finalizePresentation({
 workspaceDir:root,candidatePath:candidate,finalPath:final,
 pythonExecutable:'D:\\Anaconda3\\envs\\ielts-coach\\python.exe',
 integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),
 layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),
 layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit'],
 explicitTotalSlideCount:13,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],
 fontPolicy:{basis:'design',families:['Arial']},verifyArtifactToolImport:true,
 receiptPath:path.join(build,'validation-reviewed.json')
});
console.log('Final PPTX:',final);
await fs.writeFile(path.join(build,'finalizer-result.json'),JSON.stringify(result,null,2));
