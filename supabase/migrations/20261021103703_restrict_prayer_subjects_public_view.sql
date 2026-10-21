-- Prayer subjects remain readable by signed-in members through the filtered view,
-- but anonymous visitors must not read or mutate prayer requests through it.
REVOKE ALL PRIVILEGES ON TABLE public.prayer_subjects_public FROM anon, authenticated;
GRANT SELECT ON TABLE public.prayer_subjects_public TO authenticated;