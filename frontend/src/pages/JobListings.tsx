import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Briefcase, MapPin, Building2, Clock, Tag,
  ChevronDown, ChevronUp, Filter, ArrowUpDown, GraduationCap,
  Loader2, AlertCircle, ExternalLink, Mail, AlertTriangle,
  Send, CheckSquare, Square, Search,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { getJobs, getUserSkills, getMatchScores, triggerApply, triggerBatchApply, type JobListing, type JobSource, type MatchScore } from '../services/api';
import { useUserStore } from '../store/userStore';
import { SOURCE_LABELS } from './Jobs';

const PAGE_SIZE = 20;

type ExperienceLevel = 'any' | 'auto' | 'internship' | 'entry' | 'mid' | 'senior' | 'manager';

const EXP_LEVELS: { value: ExperienceLevel; label: string }[] = [
  { value: 'any',        label: 'Any Level' },
  { value: 'auto',       label: '✦ Auto (from resume)' },
  { value: 'internship', label: 'Internship' },
  { value: 'entry',      label: 'Entry / Fresher' },
  { value: 'mid',        label: 'Mid Level (2–5 yrs)' },
  { value: 'senior',     label: 'Senior (5+ yrs)' },
  { value: 'manager',    label: 'Manager / Lead' },
];

function relativeDate(isoOrRaw?: string): string {
  if (!isoOrRaw) return '';
  const d = new Date(isoOrRaw);
  if (isNaN(d.getTime())) return isoOrRaw;
  const diffMs   = Date.now() - d.getTime();
  const diffMin  = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMs / 3_600_000);
  const diffDay  = Math.floor(diffMs / 86_400_000);
  if (diffMin  <  1)  return 'Just now';
  if (diffMin  < 60)  return `${diffMin}m ago`;
  if (diffHour < 24)  return `${diffHour}h ago`;
  if (diffDay  <  7)  return `${diffDay}d ago`;
  if (diffDay  < 30)  return `${Math.floor(diffDay / 7)}w ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: diffDay > 365 ? 'numeric' : undefined });
}

function getScoreBadgeColor(score: number) {
  if (score > 70) return 'bg-green-100 text-green-700 border-green-200';
  if (score >= 40) return 'bg-yellow-100 text-yellow-700 border-yellow-200';
  return 'bg-red-100 text-red-700 border-red-200';
}

function JobCard({ job, matchScore, onAutoApply, isApplying, selected, onToggleSelect }: {
  job: JobListing;
  matchScore?: MatchScore;
  onAutoApply: (jobId: string) => void;
  isApplying: boolean;
  selected: boolean;
  onToggleSelect: (jobId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const src = SOURCE_LABELS[job.source] ?? { label: job.source, color: 'bg-gray-100 text-gray-600' };

  const publishLabel = job.postedAtDate
    ? relativeDate(job.postedAtDate)
    : job.postedAt
      ? job.postedAt
      : `Scraped ${relativeDate(job.scrapedAt)}`;

  const isRecent = (() => {
    const d = job.postedAtDate ? new Date(job.postedAtDate) : null;
    return d && (Date.now() - d.getTime()) < 3 * 86_400_000;
  })();

  const applyLink = job.applyUrl || job.scrapeUrl;

  return (
    <div className="card p-5 space-y-3 hover:shadow-md transition-shadow flex flex-col">
      {/* Selection + Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <button
            type="button"
            onClick={() => onToggleSelect(job._id)}
            className="mt-0.5 flex-shrink-0 text-gray-400 hover:text-primary-600 transition-colors"
            aria-label={selected ? 'Deselect job' : 'Select job'}
          >
            {selected ? <CheckSquare className="w-4 h-4 text-primary-600" /> : <Square className="w-4 h-4" />}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-900 leading-tight">{job.title}</h3>
              {isRecent && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 flex-shrink-0">
                  New
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-sm text-gray-500">
              <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{job.company}</span>
            </div>
          </div>
        </div>
        <span className={`badge flex-shrink-0 text-xs ${src.color}`}>{src.label}</span>
        {matchScore && (
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${getScoreBadgeColor(matchScore.finalScore)}`}>
              {matchScore.finalScore}% match
            </span>
            {matchScore.degraded && (
              <span className="inline-flex items-center gap-1 text-[10px] text-amber-600">
                <AlertTriangle className="w-3 h-3" /> degraded
              </span>
            )}
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="flex flex-wrap gap-3 text-xs text-gray-400">
        {job.location && (
          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.location}</span>
        )}
        <span className="flex items-center gap-1 font-medium text-gray-500">
          <Clock className="w-3 h-3" /> {publishLabel}
        </span>
      </div>

      {/* Contact email */}
      {job.contactEmail && (
        <div className="flex items-center gap-2 text-xs bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          <Mail className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
          <a href={`mailto:${job.contactEmail}`} className="text-blue-600 hover:underline font-medium truncate">
            {job.contactEmail}
          </a>
        </div>
      )}

      {/* Skills */}
      {job.matchedSkills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {job.matchedSkills.map((skill) => (
            <span key={skill} className="badge bg-primary-100 text-primary-700 text-xs">
              <Tag className="w-2.5 h-2.5 mr-1" />{skill}
            </span>
          ))}
        </div>
      )}

      {/* JD expand */}
      {job.jd && (
        <div>
          <button type="button" onClick={() => setExpanded((p) => !p)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {expanded ? 'Hide' : 'Show'} Job Description
          </button>
          {expanded && (
            <p className="mt-2 text-xs text-gray-600 bg-gray-50 rounded-lg p-3 max-h-64 overflow-auto whitespace-pre-wrap border border-gray-100">
              {job.jd.slice(0, 4000)}{job.jd.length > 4000 ? '…' : ''}
            </p>
          )}
        </div>
      )}

      {/* Apply link + Auto Apply */}
      <div className="pt-1 mt-auto space-y-2">
        {applyLink ? (
          <div className="flex gap-2">
            <a href={applyLink} target="_blank" rel="noopener noreferrer"
              className="btn-primary text-xs py-2 flex-1 justify-center gap-2">
              <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
              Apply Now
            </a>
            <button
              type="button"
              onClick={() => onAutoApply(job._id)}
              disabled={isApplying}
              className="btn-secondary text-xs py-2 justify-center gap-1.5 flex-shrink-0"
              title="Auto Apply with AI"
            >
              {isApplying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Auto
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400 bg-gray-50 rounded-lg py-2 border border-gray-200">
            <AlertCircle className="w-3.5 h-3.5" /> No apply link available
          </div>
        )}
      </div>
    </div>
  );
}

export default function JobListings() {
  const { userId } = useUserStore();
  const queryClient = useQueryClient();

  const [activeSource, setActiveSource]       = useState<JobSource | undefined>();
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>('any');
  const [sortBy, setSortBy]                   = useState<'postedAt' | 'scrapedAt' | 'matchScore'>('postedAt');
  const [page, setPage]                       = useState(0);
  const [skillFilter, setSkillFilter]         = useState('');
  const [keywordFilter, setKeywordFilter]     = useState('');
  const [selectedJobs, setSelectedJobs]       = useState<Set<string>>(new Set());

  const skillsQuery = useQuery({
    queryKey: ['userSkills', userId],
    queryFn: () => getUserSkills(userId!),
    enabled: !!userId,
    retry: false,
  });

  const resumeSkills = skillsQuery.data?.skills ?? [];
  const parsedFilter = skillFilter.split(',').map((s) => s.trim()).filter(Boolean);
  const activeSkills = parsedFilter.length > 0 ? parsedFilter : resumeSkills;

  const jobsQuery = useQuery({
    queryKey: ['jobs', userId, activeSkills, activeSource, experienceLevel, keywordFilter, sortBy, page],
    queryFn: () => getJobs({
      userId: userId!,
      skills: activeSkills,
      source: activeSource,
      experienceLevel,
      keyword: keywordFilter || undefined,
      sortBy: sortBy === 'matchScore' ? 'postedAt' : sortBy,
      limit: PAGE_SIZE,
      skip:  page * PAGE_SIZE,
    }),
    enabled: !!userId,
    retry: false,
    staleTime: 0,
  });

  const jobs  = jobsQuery.data?.jobs ?? [];
  const total = jobsQuery.data?.total ?? 0;

  // Fetch match scores for all jobs
  const scoresQuery = useQuery({
    queryKey: ['matchScores', userId],
    queryFn: () => getMatchScores(userId!, { limit: 500 }),
    enabled: !!userId,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const scoresByJobId = useMemo(() => {
    const map = new Map<string, MatchScore>();
    for (const score of scoresQuery.data?.scores ?? []) {
      map.set(score.jobId, score);
    }
    return map;
  }, [scoresQuery.data?.scores]);

  // Sort jobs by match score client-side when that sort option is active
  const sortedJobs = useMemo(() => {
    if (sortBy !== 'matchScore') return jobs;
    return [...jobs].sort((a, b) => {
      const scoreA = scoresByJobId.get(a._id)?.finalScore ?? -1;
      const scoreB = scoresByJobId.get(b._id)?.finalScore ?? -1;
      return scoreB - scoreA;
    });
  }, [jobs, sortBy, scoresByJobId]);

  // Auto apply single job
  const applyMutation = useMutation({
    mutationFn: triggerApply,
    onSuccess: () => {
      toast.success('Auto-apply queued successfully');
      queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
    onError: () => {
      toast.error('Failed to trigger auto-apply');
    },
  });

  // Batch apply
  const batchApplyMutation = useMutation({
    mutationFn: triggerBatchApply,
    onSuccess: (data) => {
      toast.success(`Batch apply queued for ${data.jobIds.length} jobs`);
      setSelectedJobs(new Set());
      queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
    onError: () => {
      toast.error('Failed to trigger batch apply');
    },
  });

  const toggleSelect = (jobId: string) => {
    setSelectedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const handleBatchApply = () => {
    const ids = Array.from(selectedJobs);
    if (ids.length === 0) {
      toast.error('Select at least one job');
      return;
    }
    if (ids.length > 50) {
      toast.error('Maximum 50 jobs allowed for batch apply');
      return;
    }
    batchApplyMutation.mutate(ids);
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Listings</h1>
          <p className="text-gray-500 mt-1">All scraped jobs from your skill profile — sorted by publish date.</p>
        </div>
        <div className="flex items-center gap-3">
          {selectedJobs.size > 0 && (
            <button
              type="button"
              onClick={handleBatchApply}
              disabled={batchApplyMutation.isPending}
              className="btn-primary text-xs py-2 gap-1.5"
            >
              {batchApplyMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Send className="w-3.5 h-3.5" />}
              Batch Apply ({selectedJobs.size})
            </button>
          )}
          {jobsQuery.isFetching && !jobsQuery.isLoading && (
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Refreshing…
            </span>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="card p-4 space-y-4">
        {/* Skill override */}
        <div className="flex items-center gap-3 flex-wrap">
          <Tag className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input type="text" value={skillFilter}
            onChange={(e) => { setSkillFilter(e.target.value); setPage(0); }}
            placeholder="Filter by skills (comma-separated), or leave blank to use resume skills"
            className="input text-sm flex-1 min-w-[200px] py-1.5" />
        </div>

        {/* Keyword search (title + description) */}
        <div className="flex items-center gap-3 flex-wrap">
          <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input type="text" value={keywordFilter}
            onChange={(e) => { setKeywordFilter(e.target.value); setPage(0); }}
            placeholder="Search by keyword in title or description"
            className="input text-sm flex-1 min-w-[200px] py-1.5" />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Experience */}
          <GraduationCap className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <select value={experienceLevel}
            onChange={(e) => { setExperienceLevel(e.target.value as ExperienceLevel); setPage(0); }}
            className="input text-sm py-1.5 w-auto">
            {EXP_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>

          {/* Source */}
          <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <div className="flex gap-1.5 flex-wrap">
            <button type="button"
              onClick={() => { setActiveSource(undefined); setPage(0); }}
              className={`badge cursor-pointer text-xs ${!activeSource ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              All
            </button>
            {(Object.keys(SOURCE_LABELS) as JobSource[]).map((src) => (
              <button key={src} type="button"
                onClick={() => { setActiveSource(src); setPage(0); }}
                className={`badge cursor-pointer text-xs ${activeSource === src ? 'bg-primary-600 text-white' : `${SOURCE_LABELS[src].color} hover:opacity-80`}`}>
                {SOURCE_LABELS[src].label}
              </button>
            ))}
          </div>

          {/* Sort */}
          <button type="button"
            onClick={() => {
              setSortBy((p) => {
                if (p === 'postedAt') return 'scrapedAt';
                if (p === 'scrapedAt') return 'matchScore';
                return 'postedAt';
              });
              setPage(0);
            }}
            className="flex items-center gap-1.5 ml-auto text-xs text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors">
            <ArrowUpDown className="w-3.5 h-3.5" />
            {sortBy === 'postedAt' ? 'Sort: Published' : sortBy === 'scrapedAt' ? 'Sort: Scraped' : 'Sort: Match Score'}
          </button>

          {total > 0 && (
            <span className="text-sm text-gray-400 whitespace-nowrap">{total} job{total !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>

      {/* Loading skeleton */}
      {jobsQuery.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-5 space-y-3 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-3 bg-gray-200 rounded w-1/2" />
              <div className="h-3 bg-gray-200 rounded w-1/3" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!jobsQuery.isLoading && sortedJobs.length === 0 && (
        <div className="card p-12 text-center">
          <Briefcase className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-500 font-medium">No jobs found</h3>
          <p className="text-sm text-gray-400 mt-1 mb-4">
            {activeSkills.length === 0
              ? 'Upload your resume so skills can be detected, or enter skills in the filter above.'
              : experienceLevel !== 'any'
                ? 'No jobs match this experience level. Try changing the filter.'
                : 'Run the Job Scraper to fetch new listings.'}
          </p>
          {experienceLevel !== 'any' && (
            <button type="button" onClick={() => setExperienceLevel('any')} className="btn-secondary mx-auto text-sm">
              Show All Levels
            </button>
          )}
        </div>
      )}

      {/* Grid */}
      {sortedJobs.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedJobs.map((job) => (
              <JobCard
                key={job._id}
                job={job}
                matchScore={scoresByJobId.get(job._id)}
                onAutoApply={(jobId) => applyMutation.mutate(jobId)}
                isApplying={applyMutation.isPending && applyMutation.variables === job._id}
                selected={selectedJobs.has(job._id)}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0} className="btn-secondary text-sm">← Previous</button>
              <span className="text-sm text-gray-500">Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}</span>
              <button type="button" onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * PAGE_SIZE >= total} className="btn-secondary text-sm">Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
