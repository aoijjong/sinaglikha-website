-- SINAGLIKHA Careers: the 20 vacancies from the job posters, added as DRAFTS
-- Run after supabase/careers.sql. Safe to run again (existing rows are left alone).
-- Only the title, department and poster are filled in. Openings, dates, type and location are blank on purpose:
-- the posters do not state them. Staffing fills them in and publishes each vacancy from the Vacancies screen.
insert into public.vacancies (slug, title, department, status, poster_path, thumb_path, sort_order) values
  ('hris-specialist', 'HRIS Specialist', 'staffing', 'draft', 'assets/careers/hris-specialist.webp', 'assets/careers/hris-specialist-t.webp', 101),
  ('talent-acquisition-specialist', 'Talent Acquisition Specialist', 'staffing', 'draft', 'assets/careers/talent-acquisition-specialist.webp', 'assets/careers/talent-acquisition-specialist-t.webp', 102),
  ('recruitment-coordinator', 'Recruitment Coordinator', 'staffing', 'draft', 'assets/careers/recruitment-coordinator.webp', 'assets/careers/recruitment-coordinator-t.webp', 103),
  ('onboarding-specialist', 'Onboarding Specialist', 'staffing', 'draft', 'assets/careers/onboarding-specialist.webp', 'assets/careers/onboarding-specialist-t.webp', 104),
  ('employer-branding-specialist', 'Employer Branding Specialist', 'staffing', 'draft', 'assets/careers/employer-branding-specialist.webp', 'assets/careers/employer-branding-specialist-t.webp', 105),
  ('learning-innovation-specialist', 'Learning Innovation Specialist', 'training', 'draft', 'assets/careers/learning-innovation-specialist.webp', 'assets/careers/learning-innovation-specialist-t.webp', 201),
  ('training-systems-specialist', 'Training Systems Specialist', 'training', 'draft', 'assets/careers/training-systems-specialist.webp', 'assets/careers/training-systems-specialist-t.webp', 202),
  ('training-program-specialist', 'Training Program Specialist', 'training', 'draft', 'assets/careers/training-program-specialist.webp', 'assets/careers/training-program-specialist-t.webp', 203),
  ('training-needs-assessment-specialist', 'Training Needs Assessment Specialist', 'training', 'draft', 'assets/careers/training-needs-assessment-specialist.webp', 'assets/careers/training-needs-assessment-specialist-t.webp', 204),
  ('employee-engagement-specialist', 'Employee Engagement Specialist', 'engagement', 'draft', 'assets/careers/employee-engagement-specialist.webp', 'assets/careers/employee-engagement-specialist-t.webp', 301),
  ('employee-engagement-coordinator', 'Employee Engagement Coordinator', 'engagement', 'draft', 'assets/careers/employee-engagement-coordinator.webp', 'assets/careers/employee-engagement-coordinator-t.webp', 302),
  ('employee-communications-specialist', 'Employee Communications Specialist', 'engagement', 'draft', 'assets/careers/employee-communications-specialist.webp', 'assets/careers/employee-communications-specialist-t.webp', 303),
  ('employee-engagement-analyst', 'Employee Engagement Analyst', 'engagement', 'draft', 'assets/careers/employee-engagement-analyst.webp', 'assets/careers/employee-engagement-analyst-t.webp', 304),
  ('compensation-and-benefits-specialist', 'Compensation & Benefits Specialist', 'rewards', 'draft', 'assets/careers/compensation-and-benefits-specialist.webp', 'assets/careers/compensation-and-benefits-specialist-t.webp', 401),
  ('performance-management-system-specialist', 'Performance Management System Specialist', 'rewards', 'draft', 'assets/careers/performance-management-system-specialist.webp', 'assets/careers/performance-management-system-specialist-t.webp', 402),
  ('performance-and-incentives-analyst', 'Performance & Incentives Analyst', 'rewards', 'draft', 'assets/careers/performance-and-incentives-analyst.webp', 'assets/careers/performance-and-incentives-analyst-t.webp', 403),
  ('rewards-program-coordinator', 'Rewards Program Coordinator', 'rewards', 'draft', 'assets/careers/rewards-program-coordinator.webp', 'assets/careers/rewards-program-coordinator-t.webp', 404),
  ('hr-compliance-officer', 'HR Compliance Officer', 'legal', 'draft', 'assets/careers/hr-compliance-officer.webp', 'assets/careers/hr-compliance-officer-t.webp', 501),
  ('employee-relations-specialist', 'Employee Relations Specialist', 'legal', 'draft', 'assets/careers/employee-relations-specialist.webp', 'assets/careers/employee-relations-specialist-t.webp', 502),
  ('health-and-safety-compliance-strategist', 'Health & Safety Compliance Strategist', 'legal', 'draft', 'assets/careers/health-and-safety-compliance-strategist.webp', 'assets/careers/health-and-safety-compliance-strategist-t.webp', 503)
on conflict (slug) do nothing;
