"""One paid, non-persistent smoke call for the configured writing provider."""

import asyncio

from app.config import Settings
from app.schemas import TaskType, WritingSubmission
from app.services.writing import get_writing_grader, validate_assessment

ESSAY = """Some people argue that university education should be free for every student. I partly agree because wider access benefits society, although a universal policy could use public money inefficiently.

First, reducing tuition fees can improve social mobility. Capable students from low-income households may abandon higher education when fees are unaffordable. If those students can study medicine, engineering or teaching, the public later gains skilled workers and a broader tax base. Financial support is therefore an investment rather than simple consumption.

However, completely free tuition for every course and every family is difficult to justify. Governments must also finance schools, hospitals, public transport and housing. Paying the full cost for wealthy students would direct scarce funds away from people with greater needs. It could also encourage some applicants to begin courses without carefully considering whether they intend to finish them.

A more balanced system would combine subsidised tuition with means-tested grants. Students from poorer families could receive full support, while higher-income households would make a reasonable contribution. Governments could also forgive part of a graduate's loan when that person works in an understaffed public service.

In conclusion, university should be financially accessible, but universal free tuition is neither the fairest nor the most sustainable solution. Targeted assistance can protect opportunity while preserving funds for other essential services."""


async def main() -> None:
    settings = Settings()
    grader = get_writing_grader(settings)
    submission = WritingSubmission(
        task_type=TaskType.writing_task_2,
        prompt="University education should be free for everyone. To what extent do you agree?",
        essay=ESSAY,
    )
    assessment = await grader.grade(submission)
    errors = validate_assessment(assessment, submission.essay)
    print(
        {
            "model": assessment.model_used,
            "overall_band": assessment.estimated_overall_band,
            "criterion_bands": {
                item.criterion.value: item.band for item in assessment.criteria
            },
            "schema_and_evidence_valid": not errors,
            "validation_errors": errors,
        }
    )


if __name__ == "__main__":
    asyncio.run(main())
