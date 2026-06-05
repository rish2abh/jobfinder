import { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Search, Loader2, Tag, Building2, AlertCircle, Database,
  RefreshCw, ChevronDown, ChevronUp, Zap, CheckCircle, XCircle,
  Settings2, SlidersHorizontal, Briefcase, MapPin,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  triggerJobScrape, getScrapeJobStatus, getUserSkills,
  type JobSource, type ScrapeJobStatus,
} from '../services/api';
import { useUserStore } from '../store/userStore';

const POLL_INTERVAL = 4000;
const ALL_SOURCES: JobSource[] = ['google', 'jsearch', 'indeed', 'naukri', 'internshala'];

export const SOURCE_LABELS: Record<JobSource, { label: string; color: string }> = {
  google:      { label: 'Google Jobs',  color: 'bg-red-100 text-red-700' },
  indeed:      { label: 'Indeed',       color: 'bg-blue-100 text-blue-700' },
  naukri:      { label: 'Naukri',       color: 'bg-orange-100 text-orange-700' },
  internshala: { label: 'Internshala',  color: 'bg-green-100 text-green-700' },
  jsearch:     { label: 'JSearch API',  color: 'bg-purple-100 text-purple-700' },
  company:     { label: 'Company',      color: 'bg-gray-100 text-gray-600' },
};

function ScrapeTracker({ jobId, data, isPolling }: {
  jobId: string; data?: ScrapeJobStatus; isPolling: boolean;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3 bg-gray-50 border-b border-gray-200">
        <Zap className="w-4 h-4 text-primary-500" />
        <span className="text-sm font-semibold text-gray-700">Scrape Progress</span>
        <span className="text-xs text-gray-400 font-mono">#{jobId}</span>
        {isPolling && (
          <span className="flex items-center gap-1 text-xs text-blue-600 ml-auto">
            <RefreshCw className="w-3 h-3 animate-spin" /> Live
          </span>
        )}
      </div>
      {data && (
        <div className="p-4 space-y-4">
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-gray-500">
              <span className="capitalize font-medium">{data.state}</span>
              <span>{data.progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className={`h-2 rounded-full transition-all duration-700 ${
                  data.state === 'failed' ? 'bg-red-500' :
                  data.state === 'completed' ? 'bg-green-500' : 'bg-primary-500'
                }`}
                style={{ width: `${data.progress}%` }}
              />
            </div>
          </div>
          {data.result && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Found',      value: data.result.totalFound,      icon: Search,      color: 'text-blue-600',  bg: 'bg-blue-50' },
                { label: 'Stored',     value: data.result.totalStored,     icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50' },
                { label: 'Duplicates', value: data.result.totalDuplicates, icon: Database,    color: 'text-gray-500',  bg: 'bg-gray-50' },
                { label: 'Flagged',    value: data.result.totalFlagged,    icon: XCircle,     color: 'text-amber-600', bg: 'bg-amber-50' },
              ].map(({ label, value, icon: Icon, color, bg }) => (
                <div key={label} className={`${bg} rounded-xl p-3 text-center`}>
                  <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
                  <p className="text-xl font-bold text-gray-900">{value}</p>
                  <p className="text-xs text-gray-500">{label}</p>
                </div>
              ))}
            </div>
          )}
          {data.result?.bySource && Object.keys(data.result.bySource).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.result.bySource).map(([src, count]) => {
                const cfg = SOURCE_LABELS[src as JobSource];
                return (
                  <span key={src} className={`badge text-xs ${cfg?.color ?? 'bg-gray-100 text-gray-600'}`}>
                    {cfg?.label ?? src}: {count as number}
                  </span>
                );
              })}
            </div>
          )}
          {data.result?.durationMs && (
            <p className="text-xs text-gray-400">Done in {(data.result.durationMs / 1000).toFixed(1)}s</p>
          )}
          {data.state === 'completed' && (
            <Link to="/dashboard/job-listings"
              className="btn-primary text-xs w-full justify-center">
              <Briefcase className="w-3.5 h-3.5" /> View Job Listings →
            </Link>
          )}
          {data.failedReason && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg p-3 border border-red-100">
              <XCircle className="w-4 h-4 flex-shrink-0" />{data.failedReason}
            </div>
          )}
        </div>
      )}
      {!data && isPolling && (
        <div className="p-4 space-y-3 animate-pulse">
          <div className="h-2 bg-gray-200 rounded-full" />
          <div className="grid grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl" />)}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Jobs() {
  const { userId } = useUserStore();

  const [activeJobId, setActiveJobId]         = useState<string | null>(null);
  const [isPolling, setIsPolling]             = useState(false);
  const [isCacheRefetching, setIsCacheRefetching] = useState(false);
  const [showAdvanced, setShowAdvanced]       = useState(false);
  const [customSkills, setCustomSkills]       = useState('');
  const [customCompanies, setCustomCompanies] = useState('');
  const [customKeywords, setCustomKeywords]   = useState('');
  const [country, setCountry]                 = useState('');
  const [selectedSources, setSelectedSources] = useState<JobSource[]>([...ALL_SOURCES]);
  const [maxPerSource, setMaxPerSource]       = useState(30);

  const skillsQuery = useQuery({
    queryKey: ['userSkills', userId],
    queryFn: () => getUserSkills(userId!),
    enabled: !!userId,
    retry: false,
  });

  const resumeSkills       = skillsQuery.data?.skills ?? [];
  const parsedCustomSkills = customSkills.split(',').map((s) => s.trim()).filter(Boolean);
  const parsedCompanies    = customCompanies.split(',').map((s) => s.trim()).filter(Boolean);
  const parsedKeywords     = customKeywords.split(',').map((s) => s.trim()).filter(Boolean);
  const activeSkills       = parsedCustomSkills.length > 0 ? parsedCustomSkills : resumeSkills;

  const toggleSource = (src: JobSource) =>
    setSelectedSources((p) => p.includes(src) ? p.filter((s) => s !== src) : [...p, src]);

  const scrapeStatusQuery = useQuery<ScrapeJobStatus>({
    queryKey: ['scrapeJob', activeJobId],
    queryFn:  () => getScrapeJobStatus(activeJobId!),
    enabled:  !!activeJobId && isPolling,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      if (state === 'completed' || state === 'failed') { setIsPolling(false); return false; }
      return POLL_INTERVAL;
    },
    retry: false,
  });

  const scrapeState = scrapeStatusQuery.data?.state;

  useEffect(() => {
    if (scrapeState === 'failed') {
      toast.error(`Scrape failed: ${scrapeStatusQuery.data?.failedReason ?? 'unknown error'}`);
    }
  }, [scrapeState]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrapeMutation = useMutation({
    mutationFn: (force: boolean) =>
      triggerJobScrape({
        userId: userId!, skills: activeSkills,
        companies: parsedCompanies, keywords: parsedKeywords,
        sources: selectedSources, maxPerSource, force,
        country: country.trim() || undefined,
      }),
    onSuccess: async (result) => {
      if (result.status === 'queued') {
        setActiveJobId((result as any).jobId);
        setIsPolling(true);
        toast.success(`Scrape queued — job #${(result as any).jobId}`);
      } else if (result.status === 'cached') {
        const count = (result as any).count ?? 0;
        toast.success(`${count} fresh jobs in cache — go to Job Listings to view`);
      } else {
        toast.error((result as any).message ?? 'No skills found — upload resume first.');
      }
    },
  });

  const isScraping = isPolling || scrapeMutation.isPending || isCacheRefetching;

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Scraper</h1>
          <p className="text-gray-500 mt-1">Configure and trigger scraping from Google Jobs, Indeed, Naukri, Internshala & JSearch.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => scrapeMutation.mutate(false)}
            disabled={isScraping || activeSkills.length === 0} className="btn-primary">
            {scrapeMutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Queuing…</>
              : isPolling
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Scraping…</>
                : <><Search className="w-4 h-4" /> Find Jobs</>}
          </button>
          <button type="button" onClick={() => scrapeMutation.mutate(true)}
            disabled={isScraping || activeSkills.length === 0}
            title="Force re-scrape (ignore cache)" className="btn-secondary">
            <RefreshCw className={`w-4 h-4 ${isScraping ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Skills panel */}
      <div className="card p-5 space-y-5">
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Tag className="w-4 h-4 text-primary-500" /> Skills Profile
            </h2>
            {skillsQuery.isLoading && <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />}
          </div>
          {resumeSkills.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-400 mb-1.5">From your resume:</p>
              <div className="flex flex-wrap gap-1.5">
                {resumeSkills.map((s) => (
                  <span key={s} className="badge bg-primary-100 text-primary-700 text-xs">{s}</span>
                ))}
              </div>
            </div>
          )}
          {resumeSkills.length === 0 && !skillsQuery.isLoading && (
            <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-3 mb-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              No skills detected — upload your resume or enter skills manually below.
            </div>
          )}
          <div>
            <label className="label text-xs">Override skills (comma-separated)</label>
            <input type="text" value={customSkills}
              onChange={(e) => setCustomSkills(e.target.value)}
              placeholder="e.g. React, Node.js, MongoDB" className="input text-sm" />
            {parsedCustomSkills.length > 0 && (
              <p className="mt-1 text-xs text-green-600">Using {parsedCustomSkills.length} custom skills</p>
            )}
          </div>
        </div>

        {/* Location / Country */}
        <div>
          <label className="label text-xs flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-gray-400" />
            Country / Location <span className="text-gray-400 font-normal">(where to search jobs)</span>
          </label>
          <input type="text" value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="e.g. India, United States, Remote, United Kingdom"
            className="input text-sm" />
        </div>

        {/* Advanced */}
        <button type="button" onClick={() => setShowAdvanced((p) => !p)}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors w-fit">
          <SlidersHorizontal className="w-4 h-4" />
          Advanced Options
          {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showAdvanced && (
          <div className="pt-1 space-y-5 border-t border-gray-100">
            <div>
              <label className="label text-xs flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-gray-400" />
                Target Companies <span className="text-gray-400 font-normal">(comma-separated)</span>
              </label>
              <input type="text" value={customCompanies} onChange={(e) => setCustomCompanies(e.target.value)}
                placeholder="e.g. Google, Microsoft, Atlassian" className="input text-sm" />
              <p className="mt-1 text-xs text-gray-400">Builds focused queries like "React developer jobs at Google"</p>
            </div>
            <div>
              <label className="label text-xs flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-gray-400" />
                Extra Keywords <span className="text-gray-400 font-normal">(comma-separated)</span>
              </label>
              <input type="text" value={customKeywords} onChange={(e) => setCustomKeywords(e.target.value)}
                placeholder="e.g. remote, senior, full-time" className="input text-sm" />
            </div>
            <div>
              <label className="label text-xs flex items-center gap-1.5">
                <Settings2 className="w-3.5 h-3.5 text-gray-400" /> Sources to Scrape
              </label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {ALL_SOURCES.map((src) => {
                  const cfg = SOURCE_LABELS[src];
                  const active = selectedSources.includes(src);
                  return (
                    <button key={src} type="button" onClick={() => toggleSource(src)}
                      className={`badge cursor-pointer transition-all select-none text-xs ${
                        active ? `ring-2 ring-offset-1 ring-primary-400 ${cfg.color}` : 'bg-gray-100 text-gray-400 line-through'
                      }`}>
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
              {selectedSources.length === 0 && <p className="text-xs text-red-500 mt-1">Select at least one source</p>}
            </div>
            <div>
              <label className="label text-xs flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-gray-400" />
                Max per source: <span className="font-semibold text-gray-700 ml-1">{maxPerSource}</span>
              </label>
              <input type="range" min={5} max={100} step={5} value={maxPerSource}
                onChange={(e) => setMaxPerSource(Number(e.target.value))}
                className="w-full accent-primary-500 mt-1" />
              <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                <span>5 (fast)</span><span>100 (thorough)</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Scrape tracker */}
      {activeJobId && (
        <ScrapeTracker jobId={activeJobId} data={scrapeStatusQuery.data} isPolling={isPolling} />
      )}

      {/* Quick nav when idle */}
      {!activeJobId && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link to="/dashboard/job-listings"
            className="card p-5 flex items-center gap-4 hover:shadow-md transition-shadow group">
            <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center group-hover:bg-primary-200 transition-colors">
              <Briefcase className="w-6 h-6 text-primary-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">View Job Listings</p>
              <p className="text-sm text-gray-500">Browse all scraped jobs</p>
            </div>
          </Link>
          <Link to="/dashboard/cache"
            className="card p-5 flex items-center gap-4 hover:shadow-md transition-shadow group">
            <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center group-hover:bg-amber-200 transition-colors">
              <Database className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">Cache Manager</p>
              <p className="text-sm text-gray-500">View, clean & manage cached jobs</p>
            </div>
          </Link>
        </div>
      )}
    </div>
  );
}
