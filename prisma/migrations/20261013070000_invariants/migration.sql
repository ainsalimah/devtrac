ALTER TABLE "Task" ADD CONSTRAINT "Task_distinct_people" CHECK ("assigneeId" <> "reviewerId");
ALTER TABLE "Task" ADD CONSTRAINT "Task_positive_version" CHECK ("version" > 0);
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_positive_revision" CHECK ("revision" > 0);
