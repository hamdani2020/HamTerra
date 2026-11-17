/**
 * Wording of the public project page (`/` and `/about`). Every statement describes what the
 * platform does today or a value from the exported evidence snapshot; nothing here is a
 * finding about the cause of a change. Backend text (summaries, limitations, notes) is not
 * copied here: it is rendered from the snapshot unchanged.
 */

export const PITCH_LINKS = {
  source: "https://github.com/hamdani2020/HamTerra",
  readme: "https://github.com/hamdani2020/HamTerra#quick-start",
  team: "https://github.com/hamdani2020",
  landsat8: "https://science.nasa.gov/mission/landsat-8",
  sentinel2: "https://sentiwiki.copernicus.eu/web/s2-mission",
  osm: "https://www.openstreetmap.org/copyright",
  /** Set to a public video URL to show the demo video link; null hides it. */
  demoVideo: null as string | null,
} as const;

/** Team members to list under HamTerra; empty shows the team name only. */
export const TEAM_MEMBERS: readonly { name: string; role: string }[] = [];

export const PITCH_TEXT = {
  brand: "Eco-Sentinel Ghana",
  navLabel: "Project sections",
  eyebrow: "NASA Space Apps Challenge · Team HamTerra",
  headline: "Satellite evidence for Ghana's mining-affected landscapes",
  tagline:
    "Eco-Sentinel turns Landsat 8 and Sentinel-2 observations into NDVI evidence that researchers can check, compare and cite, with every caveat in view.",
  ctaPlatform: "Explore the working platform",
  ctaDashboard: "Open the dashboard",
  ctaEvidence: "See the evidence",
  accountNote: "Platform accounts are issued by an administrator.",

  // Thirty-second summary
  summaryLabel: "The project in four lines",
  summary: [
    { term: "Problem", text: "Vegetation in mining-affected areas changes between field visits, and clouds often hide it from satellites." },
    { term: "What we built", text: "A working web platform that collects satellite NDVI for registered areas in Ghana and keeps the evidence auditable." },
    { term: "How", text: "Landsat 8 and Sentinel-2 observations, per-sensor NDVI statistics, quality grading and threshold-based comparisons." },
    { term: "Why it matters", text: "Researchers see which differences deserve a field visit, and why a number may not be trusted." },
  ],

  // Problem
  problemKicker: "The problem",
  problemTitle: "Change on the ground is hard to see in time",
  problemCards: [
    {
      title: "Landscapes change between visits",
      text: "Gold mining in southern Ghana reshapes land and vegetation in places that field teams can only revisit now and then.",
    },
    {
      title: "Clouds hide the ground",
      text: "Optical satellites see nothing through cloud. Over a tropical area, many scenes are unusable, and a cloudy scene can look like a sharp drop in vegetation.",
    },
    {
      title: "A number needs its context",
      text: "An NDVI value without its sensor, cloud cover, season and data coverage invites the wrong conclusion.",
    },
  ],
  cloudStatLabel: "observations of the Prestea area reported 100% cloud coverage",

  // Solution
  solutionKicker: "Our solution",
  solutionTitle: "Evidence first, conclusions left to researchers",
  solutionIntro:
    "Eco-Sentinel monitors registered polygons inside Ghana. It retrieves observations from two sensors, computes NDVI statistics and comparisons, grades every observation's quality, and flags differences for investigation.",
  doesTitle: "What the platform does",
  does: [
    "Registers monitoring polygons and checks that they lie inside Ghana",
    "Retrieves Landsat 8 and Sentinel-2 observations with cloud and data coverage",
    "Builds NDVI time series with gaps, summary values and a linear trend",
    "Compares two dates against an investigation threshold",
    "Saves reports as snapshots that later data cannot change",
  ],
  neverTitle: "What it never does",
  never: [
    "Classify a change or name its cause",
    "Say where inside a polygon a change happened",
    "Mix Sentinel-2 and Landsat 8 values in one series or comparison",
    "Treat weather as an explanation",
  ],

  // How it works
  howKicker: "How it works",
  howTitle: "From satellite pass to field question",
  steps: [
    {
      title: "Satellite observations",
      text: "For each registered polygon, the backend retrieves Landsat 8 and Sentinel-2 scenes through the AgroMonitoring API and stores cloud and data coverage separately.",
    },
    {
      title: "NDVI analysis",
      text: "Polygon-level NDVI statistics per scene, one sensor at a time: time series, gaps, a trend per 30 days, and date comparisons.",
    },
    {
      title: "Weather context",
      text: "Optional weather history for the acquisition dates, shown beside NDVI as context only. No correlation is computed. It is not enabled in the snapshot below.",
    },
    {
      title: "Investigation",
      text: "A difference at or above the threshold is flagged for investigation, together with its quality grade, warnings and limitations. A researcher decides what to check on the ground.",
    },
  ],

  // Evidence
  evidenceKicker: "Explore the evidence",
  evidenceTitle: "Real data from the Prestea monitoring area",
  evidenceIntro:
    "Everything in this section is a saved response from the platform's own API for one registered area. Nothing was edited.",
  snapshotNote: "Snapshot exported",
  areaTitle: "The monitoring area",
  areaRegistered: "Registered with AgroMonitoring",
  areaSize: "Area",
  areaCentre: "Centre",
  areaPeriod: "Snapshot period",
  areaObservations: "Observations",
  seriesTitle: "NDVI over time, one sensor at a time",
  sensorPicker: "Sensor",
  sensors: "Sensors",
  summaryCount: "Observations",
  summaryMean: "Mean of means",
  summaryRange: "Lowest and highest mean",
  summaryTrend: "Linear trend (NDVI per 30 days)",
  limitationsTitle: "Limitations returned with the series",
  galleryTitle: "Observation previews",
  galleryHint: "Select a preview to see its values.",
  galleryCloud: "Cloud",
  galleryData: "Data coverage",
  galleryMean: "Mean NDVI",
  galleryQuality: "Quality",
  compareTitle: "Two comparisons, read with their caveats",
  compareCaseTitle: (days: number) => `${days} days apart`,
  compareFlaggedNote: (cloudPct: string) =>
    `Flagged for investigation, and in the same result the comparison quality is graded poor: the scenes reported up to ${cloudPct} cloud coverage. Flagged means look closer, not that something happened.`,
  compareNotFlaggedNote: (threshold: string) =>
    `Below the investigation threshold of ${threshold}, so not flagged. The platform still reports its warnings, such as an interval that does not control for season.`,
  compareDiff: "Mean NDVI difference",
  compareInterval: "Interval",
  compareQuality: "Comparison quality",
  compareFull: "Full comparison output",
  previewAlt: (source: string, date: string) => `${source} NDVI preview of the Prestea area, ${date}`,
  previewCredit: "NDVI previews rendered by AgroMonitoring.",

  // Impact
  impactKicker: "Impact",
  impactTitle: "Why it matters",
  impact: [
    {
      title: "Better use of field time",
      text: "Flags point field teams to the areas and dates that deserve a visit, with the evidence attached.",
    },
    {
      title: "Evidence that holds up",
      text: "Each value carries its sensor, cloud cover, data coverage and quality grade. Reports are fixed snapshots, and administrative actions are audited.",
    },
    {
      title: "Honest about uncertainty",
      text: "Low-quality scenes, uneven sampling and seasonal effects are reported, not hidden. That protects researchers and communities from over-reading a number.",
    },
  ],

  // Data and technology
  dataKicker: "Data and technology",
  dataTitle: "Open Earth observation data, open-source tools",
  dataSources: [
    {
      name: "Landsat 8",
      by: "NASA and USGS",
      text: "Operational Land Imager scenes, 30 m nominal sensor resolution.",
      link: "landsat8" as const,
    },
    {
      name: "Sentinel-2",
      by: "ESA Copernicus",
      text: "MultiSpectral Instrument scenes, 10 m nominal sensor resolution.",
      link: "sentinel2" as const,
    },
    {
      name: "AgroMonitoring API",
      by: "Data access",
      text: "Polygon registration, NDVI history, scene search with cloud and data coverage, NDVI previews, optional weather history. Called only by the backend.",
      link: null,
    },
    {
      name: "OpenStreetMap",
      by: "Basemap",
      text: "Map tiles for orientation, with attribution.",
      link: "osm" as const,
    },
  ],
  stackTitle: "Built with",
  stack: [
    "FastAPI and Pydantic",
    "PostgreSQL with PostGIS",
    "React and TypeScript",
    "MapLibre GL JS",
    "Recharts",
    "AWS Cognito sign-in",
    "Docker Compose",
  ],
  learnMore: "Learn more",

  // Demo
  demoKicker: "Project demo",
  demoTitle: "Try it, read it, run it",
  demoPlatform: "Working platform",
  demoPlatformText: "Sign in to the researcher dashboard, map, time series, comparisons and reports.",
  demoPlatformButton: "Sign in to the platform",
  demoTry: "Demo without an account",
  demoSource: "Source code",
  demoSourceText: "Backend, frontend, specifications and tests on GitHub.",
  demoSourceLink: "Open the repository",
  demoVideo: "Demo video",
  demoVideoText: "A walk-through of the platform.",
  demoVideoLink: "Watch the demo",
  demoLocal: "Run it locally",
  demoLocalText: "One Docker Compose command starts the database, API and web app.",
  demoLocalLink: "Read the quick start",
  opensInNewTab: "(opens in a new tab)",

  // Team
  teamKicker: "Team",
  teamTitle: "HamTerra",
  teamText: "HamTerra is the team behind Eco-Sentinel Ghana, built for the NASA Space Apps Challenge.",
  teamLink: "HamTerra on GitHub",

  // Footer
  footerData:
    "Landsat 8 data courtesy of NASA and the U.S. Geological Survey. Contains modified Copernicus Sentinel data 2026. NDVI previews and statistics retrieved through AgroMonitoring.",
  footerAbout: "About the project",
  backToTop: "Back to top",
} as const;

export const PITCH_SECTIONS = [
  { id: "problem", label: "Problem" },
  { id: "solution", label: "Solution" },
  { id: "how-it-works", label: "How it works" },
  { id: "evidence", label: "Evidence" },
  { id: "impact", label: "Impact" },
  { id: "data", label: "Data" },
  { id: "demo", label: "Demo" },
  { id: "team", label: "Team" },
] as const;
