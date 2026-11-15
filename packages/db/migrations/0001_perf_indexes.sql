CREATE INDEX "calendar_events_account_idx" ON "calendar_events" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "daily_plan_items_plan_idx" ON "daily_plan_items" USING btree ("plan_id","position");--> statement-breakpoint
CREATE INDEX "notifications_reminder_idx" ON "notifications" USING btree ("reminder_id");--> statement-breakpoint
CREATE INDEX "notifications_task_idx" ON "notifications" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "notifications_event_idx" ON "notifications" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reminders_user_status_idx" ON "reminders" USING btree ("user_id","status","remind_at");--> statement-breakpoint
CREATE INDEX "reminders_task_idx" ON "reminders" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "reminders_event_idx" ON "reminders" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "subtasks_task_idx" ON "subtasks" USING btree ("task_id","position");--> statement-breakpoint
CREATE INDEX "synced_emails_user_thread_idx" ON "synced_emails" USING btree ("user_id","thread_id");--> statement-breakpoint
CREATE INDEX "task_completions_task_idx" ON "task_completions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "tasks_project_idx" ON "tasks" USING btree ("project_id");