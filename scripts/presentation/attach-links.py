"""Restore picture hyperlinks omitted by the current PPTX exporter."""
from pathlib import Path
import sys
import re
import json
import xml.etree.ElementTree as ET
from zipfile import ZipFile, ZIP_DEFLATED

P = "http://schemas.openxmlformats.org/presentationml/2006/main"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"

def route(name):
    if name.startswith("profile"): return "/profile"
    if name.startswith(("plan", "task")): return "/plan"
    if name.startswith("word"): return "/vocabulary"
    if name.startswith("reading"): return "/question-bank?module=reading"
    if name.startswith("writing"): return "/writing"
    if name == "overview": return "/"
    return "/resources"

def main():
    pptx = Path(sys.argv[1])
    with ZipFile(pptx) as archive:
        entries = {name: archive.read(name) for name in archive.namelist()}
    slides = json.loads((Path(__file__).resolve().parents[2]/"docs/presentation/slides.json").read_text(encoding="utf-8"))
    count = 0
    for name, data in list(entries.items()):
        if not name.startswith("ppt/slides/slide") or not name.endswith(".xml"): continue
        tree = ET.fromstring(data)
        relname = "ppt/slides/_rels/" + Path(name).name + ".rels"
        relationships = ET.fromstring(entries[relname])
        slide_number = int(re.search(r"slide(\d+).xml$", name).group(1))
        pictures = tree.findall(f".//{{{P}}}pic")
        assets = slides[slide_number-1]["assets"]
        assert len(pictures) == len(assets), (slide_number, len(pictures), assets)
        for picture_index, picture in enumerate(tree.findall(f".//{{{P}}}pic")):
            props = picture.find(f"{{{P}}}nvPicPr/{{{P}}}cNvPr")
            description = props.get("descr", "")
            prefix = "Actual offline application capture with English presentation labels: "
            description = prefix + assets[picture_index]
            props.set("descr", description)
            if props.find(f"{{{A}}}hlinkClick") is not None: continue
            identifier = f"demoLink{count+1}"
            props.insert(0, ET.Element(f"{{{A}}}hlinkClick", {f"{{{R}}}id": identifier}))
            ET.SubElement(relationships, f"{{{REL}}}Relationship", {
                "Id": identifier, "Type": R + "/hyperlink", "TargetMode": "External",
                "Target": "http://127.0.0.1:3000" + route(description[len(prefix):])})
            count += 1
        entries[name] = ET.tostring(tree, encoding="utf-8", xml_declaration=True)
        entries[relname] = ET.tostring(relationships, encoding="utf-8", xml_declaration=True)
    temporary = pptx.with_suffix(".links.pptx")
    with ZipFile(temporary, "w", ZIP_DEFLATED) as archive:
        for name, data in entries.items(): archive.writestr(name, data)
    temporary.replace(pptx)
    print(f"Attached {count} screenshot hyperlinks")

if __name__ == "__main__": main()
