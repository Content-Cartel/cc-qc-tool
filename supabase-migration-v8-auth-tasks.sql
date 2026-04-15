-- ============================================================================
-- Migration v8: Auth, Profiles, Editor Assignments, Tasks, Activity Log
-- ============================================================================
-- This migration adds:
-- 1. profiles table (maps auth.users to app roles)
-- 2. editor_assignments table (editor → client mapping)
-- 3. tasks table (editor task tracker with deadlines)
-- 4. task_activity_log table (audit trail)
-- 5. RLS policies for all new tables
-- 6. Auto-create profile trigger on auth.users insert
-- 7. Indexes and realtime configuration
-- ============================================================================

-- ============================================================================
-- 1. PROFILES TABLE
-- ============================================================================

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor', 'production_manager', 'admin')),
  slack_user_id TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helper function: get current user's role (created after profiles exists)
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: check if current user is PM or admin
CREATE OR REPLACE FUNCTION public.is_pm_or_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role IN ('production_manager', 'admin')
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "PM and admin can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_pm_or_admin());

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Service role can insert profiles"
  ON public.profiles FOR INSERT
  WITH CHECK (true);

-- Index
CREATE INDEX idx_profiles_role ON public.profiles(role);

-- ============================================================================
-- 2. EDITOR ASSIGNMENTS TABLE
-- ============================================================================

CREATE TABLE public.editor_assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  editor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(editor_id, client_id)
);

-- Enable RLS
ALTER TABLE public.editor_assignments ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Editors can view own assignments"
  ON public.editor_assignments FOR SELECT
  USING (auth.uid() = editor_id);

CREATE POLICY "PM and admin can view all assignments"
  ON public.editor_assignments FOR SELECT
  USING (public.is_pm_or_admin());

CREATE POLICY "PM and admin can manage assignments"
  ON public.editor_assignments FOR INSERT
  WITH CHECK (public.is_pm_or_admin());

CREATE POLICY "PM and admin can delete assignments"
  ON public.editor_assignments FOR DELETE
  USING (public.is_pm_or_admin());

-- Indexes
CREATE INDEX idx_editor_assignments_editor ON public.editor_assignments(editor_id);
CREATE INDEX idx_editor_assignments_client ON public.editor_assignments(client_id);

-- ============================================================================
-- 3. TASKS TABLE
-- ============================================================================

CREATE TABLE public.tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES public.clients(id),
  editor_id UUID REFERENCES public.profiles(id),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  title TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('long_form', 'short_form')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'in_progress', 'in_review', 'revision_needed', 'approved')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  deadline TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  source_file_url TEXT,
  editing_instructions TEXT,
  notes TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Editors can view own tasks"
  ON public.tasks FOR SELECT
  USING (auth.uid() = editor_id);

CREATE POLICY "PM and admin can view all tasks"
  ON public.tasks FOR SELECT
  USING (public.is_pm_or_admin());

CREATE POLICY "PM and admin can create tasks"
  ON public.tasks FOR INSERT
  WITH CHECK (public.is_pm_or_admin());

CREATE POLICY "Editors can update own task status"
  ON public.tasks FOR UPDATE
  USING (auth.uid() = editor_id);

CREATE POLICY "PM and admin can update any task"
  ON public.tasks FOR UPDATE
  USING (public.is_pm_or_admin());

CREATE POLICY "PM and admin can delete tasks"
  ON public.tasks FOR DELETE
  USING (public.is_pm_or_admin());

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.handle_task_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_task_updated
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_task_updated_at();

-- Auto-set completed_at when status changes to approved
CREATE OR REPLACE FUNCTION public.handle_task_completion()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
    NEW.completed_at = NOW();
  END IF;
  IF NEW.status != 'approved' AND OLD.status = 'approved' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_task_status_change
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_task_completion();

-- Indexes
CREATE INDEX idx_tasks_editor ON public.tasks(editor_id);
CREATE INDEX idx_tasks_client ON public.tasks(client_id);
CREATE INDEX idx_tasks_status ON public.tasks(status);
CREATE INDEX idx_tasks_deadline_active ON public.tasks(deadline) WHERE status IN ('queued', 'in_progress');
CREATE INDEX idx_tasks_created_by ON public.tasks(created_by);

-- ============================================================================
-- 4. TASK ACTIVITY LOG
-- ============================================================================

CREATE TABLE public.task_activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id),
  action TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.task_activity_log ENABLE ROW LEVEL SECURITY;

-- Policies (same access as tasks)
CREATE POLICY "Editors can view own task activity"
  ON public.task_activity_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks
      WHERE tasks.id = task_activity_log.task_id
      AND tasks.editor_id = auth.uid()
    )
  );

CREATE POLICY "PM and admin can view all activity"
  ON public.task_activity_log FOR SELECT
  USING (public.is_pm_or_admin());

CREATE POLICY "Authenticated users can insert activity"
  ON public.task_activity_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Index
CREATE INDEX idx_task_activity_task ON public.task_activity_log(task_id);
CREATE INDEX idx_task_activity_created ON public.task_activity_log(created_at);

-- ============================================================================
-- 5. AUTO-CREATE PROFILE ON AUTH USER CREATION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'editor')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 6. REALTIME
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_activity_log;

-- ============================================================================
-- 7. UPDATED_AT TRIGGER FOR PROFILES
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_profile_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_profile_updated
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_profile_updated_at();
