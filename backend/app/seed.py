from __future__ import annotations

from sqlalchemy import select, text

from app.config import get_settings
from app.db import KnowledgeChunkRow, KnowledgeDocumentRow, PracticeQuestionRow, SessionLocal
from app.services.embeddings import VECTOR_DIMENSIONS, embed_text
from app.services.rag import OFFICIAL_RUBRIC_SUMMARIES

OFFICIAL_DOCUMENT_ID = "official-ielts-writing-rubric"

READING_PASSAGE = """Cooling the city

As cities grow, dark roofs and paved surfaces absorb solar energy during the day and release it slowly at night. This process creates an urban heat island: built-up districts remain warmer than nearby rural areas. City governments have therefore begun testing ways to reduce street-level temperatures without relying solely on air conditioning.

One approach is to increase tree cover. Trees shade walls and pavements, while water released through their leaves can cool the surrounding air. Yet planting programmes do not produce identical results everywhere. Young trees provide little shade, some species require large amounts of water, and dense planting can restrict air movement in narrow streets. Researchers therefore argue that canopy size, local climate and street design must be considered together.

Cool roofs offer another option. These roofs use pale or reflective materials to send more sunlight back into the atmosphere. In a two-year study, researchers monitored comparable school buildings in three neighbourhoods. The buildings with reflective roofs required less electricity for cooling during summer afternoons. The study did not, however, measure whether pupils felt more comfortable inside the classrooms.

A third strategy replaces sealed ground with surfaces that allow rainwater to pass through. The stored water may later evaporate and cool the area, while also reducing pressure on drainage systems during storms. Installation costs are higher than for ordinary asphalt, but maintenance costs vary according to traffic levels and the material used.

Most researchers now recommend combining several measures rather than selecting a single universal solution. They also warn that average city-wide temperatures can hide important differences between neighbourhoods. Low-income districts often have fewer mature trees and more exposed paved areas. For that reason, several cities now use heat maps and public-health data to decide where investment should be made first."""

LISTENING_SCRIPT = """Receptionist: Westbridge Community Centre. How can I help?
Caller: Hi, I'd like to join the weekend photography course. Is there still a place?
Receptionist: Yes. The next course starts on Saturday the fourteenth of October and runs for six weeks.
Caller: Great. What time does it begin?
Receptionist: At nine fifteen in the morning. It used to start at nine thirty, but the tutor changed it this term.
Caller: And where is it held?
Receptionist: Most sessions are in Room 3B. On the final Saturday, the group meets at Riverside Park for an outdoor project.
Caller: How much does it cost?
Receptionist: The standard fee is seventy-eight pounds. Full-time students pay sixty-five pounds if they show a valid student card when they register.
Caller: Do I need an expensive camera?
Receptionist: No. Bring any digital camera you already have. The centre can lend you a tripod, but memory cards aren't provided.
Caller: Fine. Can I register under the name Mei Lin? That's M-E-I, then L-I-N.
Receptionist: Certainly. I'll reserve your place until five o'clock tomorrow. You can pay online or at reception."""

PROJECT_QUESTIONS = (
    {
        "id": "70afabec-96cc-4d89-8786-89f99a5f5a11",
        "module": "reading",
        "task_type": "true_false_not_given",
        "question_type": "single_choice",
        "passage": READING_PASSAGE,
        "prompt": "1. Tree-planting programmes have the same cooling effect in every city.",
        "options": ["True", "False", "Not Given"],
        "correct_answer": "False",
        "explanation": "第二段指出树种、树冠、本地气候和街道设计都会影响结果，因此该说法与原文相反。",
        "tags": ["判断题", "定位", "原创仿真"],
        "source_name": "原创 Academic Reading 模拟：城市降温研究",
    },
    {
        "id": "be611a3d-daef-402d-b1d9-4682b72f6973",
        "module": "reading",
        "task_type": "multiple_choice",
        "question_type": "single_choice",
        "passage": READING_PASSAGE,
        "prompt": "2. What did the school-building study find about reflective roofs?",
        "options": ["They improved classroom comfort.", "They reduced summer cooling electricity use.", "They were cheaper to maintain than dark roofs.", "They worked equally well in every neighbourhood."],
        "correct_answer": "They reduced summer cooling electricity use.",
        "explanation": "第三段明确说，使用反射屋顶的建筑在夏日下午所需的制冷电力更少。舒适度并未测量。",
        "tags": ["单选题", "细节理解", "原创仿真"],
        "source_name": "原创 Academic Reading 模拟：城市降温研究",
    },
    {
        "id": "f7dfb403-727a-46ee-ad48-23cb4c7a631a",
        "module": "listening",
        "task_type": "form_completion",
        "question_type": "short_answer",
        "passage": LISTENING_SCRIPT,
        "prompt": "1. Course start time: ______",
        "options": [],
        "correct_answer": "9:15",
        "explanation": "录音中先提到旧时间 9:30，随后明确本学期改为 9:15，需要识别干扰信息。",
        "tags": ["Section 1", "表格填空", "时间", "原创仿真"],
        "source_name": "原创 Listening Section 1 模拟：社区课程报名",
    },
    {
        "id": "cf908938-f8a0-46e0-ab69-6ca9e87da48c",
        "module": "writing",
        "task_type": "writing_task_2",
        "question_type": "essay",
        "prompt": "Some cities are replacing car parking spaces with public green areas. Do the advantages outweigh the disadvantages?",
        "options": [],
        "correct_answer": None,
        "explanation": "Build a clear position, compare both sides, and support each main idea with a specific explanation or example.",
        "tags": ["Task 2", "利弊讨论", "原创题目"],
        "source_name": "原创 Academic Writing 模拟题",
    },
    {
        "id": "64ec331e-1829-4c63-b2d5-43c41dd2d957",
        "module": "writing",
        "task_type": "writing_task_1",
        "question_type": "report_plan",
        "prompt": "The table below shows the percentage of commuters using four forms of transport in the city of Norchester in 2005 and 2025. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.\n\nCar: 52% → 38%\nBus: 24% → 27%\nBicycle: 9% → 21%\nWalking: 15% → 14%",
        "options": [],
        "correct_answer": None,
        "explanation": "A useful overview identifies dominant categories and major changes without listing every value.",
        "tags": ["Task 1", "概述句", "原创题目"],
        "source_name": "原创 Academic Writing 模拟题",
    },
    {
        "id": "4478ef17-969a-41e2-ac0e-edf371b28140",
        "module": "speaking",
        "task_type": "speaking_part_2",
        "question_type": "cue_card",
        "prompt": "Describe a skill you learned from another person. Say what it was, who taught you, how you learned it, and why it was useful.",
        "options": [],
        "correct_answer": None,
        "explanation": "Use the prompts as support, but organise the response as a connected two-minute story.",
        "tags": ["Part 2", "人物经历", "原创题目"],
        "source_name": "原创 Speaking 模拟题",
    },
    {
        "id": "2d5300de-419d-4cfe-9107-c55f82e93e22",
        "module": "reading",
        "task_type": "true_false_not_given",
        "question_type": "single_choice",
        "passage": READING_PASSAGE,
        "prompt": "3. The school study compared pupils' opinions before and after cool roofs were installed.",
        "options": ["True", "False", "Not Given"],
        "correct_answer": "False",
        "explanation": "研究没有测量学生的室内舒适感，因此不存在题干所说的前后意见比较。",
        "tags": ["判断题", "否定信息", "原创仿真"],
        "source_name": "原创 Academic Reading 模拟：城市降温研究",
    },
    {
        "id": "31e9f8c1-cb9f-4f99-a8ed-c2d980b7f18e",
        "module": "reading",
        "task_type": "sentence_completion",
        "question_type": "short_answer",
        "passage": READING_PASSAGE,
        "prompt": "4. Cities can combine heat maps with ______ data to decide which areas need investment first.\nWrite NO MORE THAN TWO WORDS.",
        "options": [],
        "correct_answer": "public-health",
        "explanation": "答案来自末段的 heat maps and public-health data；不得超过两个词。",
        "tags": ["句子填空", "词数限制", "原创仿真"],
        "source_name": "原创 Academic Reading 模拟：城市降温研究",
    },
    {
        "id": "4d3ae78b-7ccf-4417-bcc7-97809b0f30e4",
        "module": "listening",
        "task_type": "form_completion",
        "question_type": "short_answer",
        "passage": LISTENING_SCRIPT,
        "prompt": "2. Usual classroom: Room ______",
        "options": [],
        "correct_answer": "3B",
        "explanation": "常规课程在 Room 3B；最后一周的 Riverside Park 是干扰信息。",
        "tags": ["Section 1", "表格填空", "地点", "原创仿真"],
        "source_name": "原创 Listening Section 1 模拟：社区课程报名",
    },
    {
        "id": "5be962af-94a8-405b-aadb-9f20cbf56a55",
        "module": "listening",
        "task_type": "form_completion",
        "question_type": "short_answer",
        "passage": LISTENING_SCRIPT,
        "prompt": "3. Fee for a full-time student: £______",
        "options": [],
        "correct_answer": "65",
        "explanation": "标准价格是 £78，但全日制学生凭有效学生证支付 £65。",
        "tags": ["Section 1", "表格填空", "价格", "原创仿真"],
        "source_name": "原创 Listening Section 1 模拟：社区课程报名",
    },
    {
        "id": "69fa4f08-e8b4-4d08-a132-1ee423cba7cc",
        "module": "listening",
        "task_type": "form_completion",
        "question_type": "short_answer",
        "passage": LISTENING_SCRIPT,
        "prompt": "4. Item not supplied by the centre: ______",
        "options": [],
        "correct_answer": "memory cards",
        "explanation": "中心可以借出三脚架，但不提供 memory cards。",
        "tags": ["Section 1", "表格填空", "物品", "原创仿真"],
        "source_name": "原创 Listening Section 1 模拟：社区课程报名",
    },
    {
        "id": "74505e57-f7ca-4db7-876d-0a34b99c82cf",
        "module": "speaking",
        "task_type": "speaking_part_3",
        "question_type": "discussion",
        "prompt": "Do you think schools should spend more time teaching practical skills? Why or why not?",
        "options": [],
        "correct_answer": None,
        "explanation": "先给出明确观点，再用原因、例子和必要的让步展开，避免只回答 yes 或 no。",
        "tags": ["Part 3", "教育", "观点拓展", "原创题目"],
        "source_name": "原创 Speaking 模拟题",
    },
)


async def seed_question_bank() -> None:
    async with SessionLocal() as session:
        existing = (
            await session.scalars(
                select(PracticeQuestionRow).where(
                    PracticeQuestionRow.id.in_([item["id"] for item in PROJECT_QUESTIONS]),
                    PracticeQuestionRow.owner_id.is_(None),
                )
            )
        ).all()
        by_id = {row.id: row for row in existing}
        for item in PROJECT_QUESTIONS:
            if row := by_id.get(item["id"]):
                for key, value in item.items():
                    if key != "id":
                        setattr(row, key, value)
                continue
            session.add(PracticeQuestionRow(**item, owner_id=None))
        await session.commit()


async def seed_official_knowledge() -> None:
    async with SessionLocal() as session:
        exists = await session.scalar(
            select(KnowledgeDocumentRow).where(KnowledgeDocumentRow.id == OFFICIAL_DOCUMENT_ID)
        )
        if exists:
            rows = (
                await session.scalars(
                    select(KnowledgeChunkRow).where(
                        KnowledgeChunkRow.document_id == OFFICIAL_DOCUMENT_ID
                    )
                )
            ).all()
            settings = get_settings()
            is_current = len(rows) == len(OFFICIAL_RUBRIC_SUMMARIES) and all(
                len(chunk.embedding or []) == VECTOR_DIMENSIONS
                and chunk.metadata_json.get("embedding_model")
                == settings.local_embedding_model
                for chunk in rows
            )
            if is_current:
                return
            for chunk in rows:
                await session.delete(chunk)
            await session.flush()
            document = exists
        else:
            document = KnowledgeDocumentRow(
                id=OFFICIAL_DOCUMENT_ID,
                owner_id=None,
                title="IELTS Writing Band Descriptors",
                filename="ielts-writing-band-descriptors.pdf",
                source_url="https://ielts.org/cdn/ielts-guides/ielts-writing-band-descriptors.pdf",
                license_type="official-public-link-paraphrase",
                status="completed",
            )
            session.add(document)
        for index, source in enumerate(OFFICIAL_RUBRIC_SUMMARIES):
            embedding, model = await embed_text(source.content, get_settings())
            session.add(
                KnowledgeChunkRow(
                    id=source.chunk_id,
                    document_id=document.id,
                    owner_id=None,
                    content=source.content,
                    page=source.page,
                    chunk_index=index,
                    metadata_json={
                        "module": "writing",
                        "license": document.license_type,
                        "embedding_model": model,
                    },
                    embedding=embedding,
                )
            )
        await session.flush()
        if session.bind and session.bind.dialect.name == "postgresql":
            rows = (
                await session.scalars(
                    select(KnowledgeChunkRow).where(
                        KnowledgeChunkRow.document_id == OFFICIAL_DOCUMENT_ID
                    )
                )
            ).all()
            for chunk in rows:
                await session.execute(
                    text(
                        "UPDATE knowledge_chunks SET embedding_vector = CAST(:embedding AS vector) "
                        "WHERE id = :chunk_id"
                    ),
                    {"embedding": str(chunk.embedding), "chunk_id": chunk.id},
                )
        await session.commit()
