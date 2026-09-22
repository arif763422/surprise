-- =============================================================================
-- A LITTLE JOURNEY — Supabase Database & Storage Setup Schema
-- Run this script in the Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- =============================================================================

-- 1. Create the links table
CREATE TABLE IF NOT EXISTS public.links (
  "id"                 TEXT PRIMARY KEY,
  "linkId"             TEXT,
  "createdBy"          TEXT,
  "createdAt"          TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  "active"             BOOLEAN DEFAULT true,
  "myLatitude"         DOUBLE PRECISION,
  "myLongitude"        DOUBLE PRECISION,
  "myLocationAccuracy" DOUBLE PRECISION
);

-- 2. Create the visitors table (stores consented journey responses)
CREATE TABLE IF NOT EXISTS public.visitors (
  "id"                   TEXT PRIMARY KEY,
  "visitorId"            TEXT,
  "linkId"               TEXT REFERENCES public.links("id") ON DELETE CASCADE,
  "createdAt"            TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  "lastUpdatedAt"        TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  "arrivalTime"          TEXT,
  "locationPermission"   TEXT,
  "latitude"             DOUBLE PRECISION,
  "longitude"            DOUBLE PRECISION,
  "locationAccuracy"     DOUBLE PRECISION,
  "distanceKm"           DOUBLE PRECISION,
  "roadDistanceKm"       DOUBLE PRECISION,
  "deviceType"           TEXT,
  "browser"              TEXT,
  "platform"             TEXT,
  "screenWidth"          INTEGER,
  "screenHeight"         INTEGER,
  "language"             TEXT,
  "timezone"             TEXT,
  "choiceOne"            TEXT,
  "choiceTwo"            TEXT,
  "sliderValue"          INTEGER,
  "cameraPermission"     TEXT,
  "videoUrl"             TEXT,
  "microphonePermission" TEXT,
  "voiceUrl"             TEXT,
  "journeyProgress"      DOUBLE PRECISION,
  "journeyCompleted"     BOOLEAN DEFAULT false,
  "completedAt"          TEXT
);

-- 3. Create Performance Indexes
CREATE INDEX IF NOT EXISTS idx_links_created ON public.links ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_visitors_link ON public.visitors ("linkId");
CREATE INDEX IF NOT EXISTS idx_visitors_created ON public.visitors ("createdAt" DESC);

-- 4. Enable Supabase Realtime for Live Admin Dashboard
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'links'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.links;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'visitors'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.visitors;
  END IF;
END $$;

-- 5. Row Level Security (RLS) Configuration
ALTER TABLE public.links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitors ENABLE ROW LEVEL SECURITY;

-- Clean existing policies if re-running
DROP POLICY IF EXISTS "Allow public read for links" ON public.links;
DROP POLICY IF EXISTS "Allow authenticated full access to links" ON public.links;
DROP POLICY IF EXISTS "Allow public insert for visitors" ON public.visitors;
DROP POLICY IF EXISTS "Allow public update for visitors" ON public.visitors;
DROP POLICY IF EXISTS "Allow select on visitors" ON public.visitors;
DROP POLICY IF EXISTS "Allow authenticated delete on visitors" ON public.visitors;

-- Links Policies
CREATE POLICY "Allow public read for links"
  ON public.links FOR SELECT
  USING (true);

CREATE POLICY "Allow authenticated full access to links"
  ON public.links FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Visitors Policies
CREATE POLICY "Allow public insert for visitors"
  ON public.visitors FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow public update for visitors"
  ON public.visitors FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow select on visitors"
  ON public.visitors FOR SELECT
  USING (true);

CREATE POLICY "Allow authenticated delete on visitors"
  ON public.visitors FOR DELETE
  TO authenticated
  USING (true);

-- 6. Storage Bucket Setup ('alj-media')
INSERT INTO storage.buckets (id, name, public)
VALUES ('alj-media', 'alj-media', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage Policies
DROP POLICY IF EXISTS "Allow public uploads to alj-media" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read from alj-media" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated delete from alj-media" ON storage.objects;

CREATE POLICY "Allow public uploads to alj-media"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'alj-media');

CREATE POLICY "Allow public read from alj-media"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'alj-media');

CREATE POLICY "Allow authenticated delete from alj-media"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'alj-media');
