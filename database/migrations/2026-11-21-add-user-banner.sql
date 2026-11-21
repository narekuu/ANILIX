-- Run once in the Supabase SQL Editor before deploying the account banner update.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS banner TEXT;
