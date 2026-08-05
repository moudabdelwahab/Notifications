-- The inbox lets a user clear notifications; without this policy the delete
-- silently affects zero rows under RLS.
drop policy if exists "Users can delete their own notifications" on public.notifications;
create policy "Users can delete their own notifications" on public.notifications
  for delete using (auth.uid() = user_id);
