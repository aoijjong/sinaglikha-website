-- Label colours for Community forum categories.
-- Safe to run more than once. Run it in the Supabase SQL editor.
--
-- A category stores a colour NAME (rose, peach, butter, sage, mint, sky, lavender, blush, stone), never a colour
-- value; the pages decide how each name looks (assets/forum-colors.js). A category with no colour still shows a
-- steady colour worked out from its id, so nothing breaks if this has not been run.

alter table public.forum_categories add column if not exists color text;

alter table public.forum_categories drop constraint if exists forum_categories_color_check;
alter table public.forum_categories add constraint forum_categories_color_check check (color is null or color ~ '^[a-z]{2,20}$');

-- Senior Managers can set the colour when they add or edit a category (the other columns were granted in phase3.sql).
grant insert (color) on public.forum_categories to authenticated;
grant update (color) on public.forum_categories to authenticated;

-- Give the categories that exist today different colours, in their current order. Ones already coloured are left alone.
update public.forum_categories c
   set color = (array['rose','sage','sky','peach','lavender','mint','butter','blush','stone'])[1 + (n.rn - 1) % 9]
  from (select id, row_number() over (order by position, created_at) as rn from public.forum_categories where color is null) n
 where c.id = n.id;
