"""Isolated, project-authored synthetic examples. Never persisted as learner results."""

DEMO = {
    "mode": "demo",
    "prompt": "Governments should make university education free for everyone. To what extent do you agree or disagree?",
    "knowledge": [
        {
            "title": "however",
            "category": "vocabulary",
            "content": "示例词汇记录：曾把 however 理解成因果词；它在这里表示转折。",
        },
        {
            "title": "论据与结论",
            "category": "mistake",
            "content": "示例阅读错题：把支持局部观点的证据误当成全文结论。",
        },
    ],
    "versions": [
        {
            "essay": "I agree that university should be free. Education is important. However, it helps students get jobs. Governments should pay because this is good for everyone.",
            "issues": [
                {
                    "title": "连接关系",
                    "quote": "However, it helps students get jobs.",
                    "text": "前后都是支持免费教育的理由，however 表示的转折关系不成立。",
                    "source": "个人词汇：however；公共依据：连贯与衔接",
                },
                {
                    "title": "论证展开",
                    "quote": "Governments should pay because this is good for everyone.",
                    "text": "说明哪些群体受益，以及免费教育如何产生这些益处。",
                    "source": "公共依据：任务回应",
                },
            ],
            "hints": [
                "这两句话是相互支持，还是相互转折？",
                "先确定逻辑关系，再决定是否需要连接词。",
                "For example, removing tuition fees could help students from low-income families enter university.",
            ],
        },
        {
            "essay": "I support free tuition for students from low-income families. Removing tuition fees could allow them to gain professional qualifications without taking on large debts. For example, a student who cannot afford tuition could train as a teacher and later contribute to local schools. Governments should target this support carefully because public budgets must also fund other essential services.",
            "issues": [
                {
                    "title": "已改善 · 连接关系",
                    "quote": "For example, a student who cannot afford tuition could train as a teacher and later contribute to local schools.",
                    "text": "新稿使用例证展开观点，已移除不成立的 however 转折。",
                    "source": "对照初稿与修改稿",
                },
                {
                    "title": "部分改善 · 立场范围",
                    "quote": "I support free tuition for students from low-income families.",
                    "text": "受益群体更具体；仍应说明为什么不支持题目中的 everyone。",
                    "source": "公共依据：任务回应",
                },
            ],
            "hints": [
                "题目说 everyone，而你的立场限定了哪些人？",
                "补充解释为什么将公共资助优先分配给低收入学生。",
                "Universal free tuition may divert limited funds from students who need support most.",
            ],
        },
    ],
    "answer": "示例学习记录显示，你曾在词义题中混淆 however 的关系。初稿中的两句话都在支持教育的好处，因此没有形成转折。先用中文概括两句的关系，再选择英文连接表达；修改稿用 For example 展开例子，更符合这里的逻辑。",
    "citations": [
        {
            "source_id": "demo-vocabulary",
            "title": "however · 示例学习记录",
            "excerpt": "曾把 however 理解成因果词。",
            "source_type": "vocabulary",
        },
        {
            "source_id": "demo-rubric",
            "title": "Coherence and Cohesion",
            "excerpt": "衔接表达应符合实际逻辑关系。",
            "source_type": "public",
            "url": "https://ielts.org/cdn/ielts-guides/ielts-writing-band-descriptors.pdf",
        },
    ],
}
