import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Briefcase, MapPin, Building2, Clock, Tag, Database,
  ChevronDown, ChevronUp, Filter, ArrowUpDown, GraduationCap,
  Loader2, AlertCircle, Search, ExternalLink, Mail,
} from 'lucide-react';
import { getJobs, getUserSkills, type JobListing, type JobSource } from '../services/api';
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

function JobCard({ job }: { job: JobListing }) {
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
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
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
        <span className={`badge flex-shrink-0 text-xs ${src.color}`}>{src.label}</span>
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
              {job.jd.slice(0, 3000)}{job.jd.length > 3000 ? '…' : ''}
            </p>
          )}
        </div>
      )}

      {/* Apply link */}
      <div className="pt-1 mt-auto">
        {applyLink ? (
          <a href={applyLink} target="_blank" rel="noopener noreferrer"
            className="btn-primary text-xs py-2 w-full justify-center gap-2">
            <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
            Apply Now
          </a>
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

  const [activeSource, setActiveSource]       = useState<JobSource | undefined>();
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>('any');
  const [sortBy, setSortBy]                   = useState<'postedAt' | 'scrapedAt'>('postedAt');
  const [page, setPage]                       = useState(0);
  const [skillFilter, setSkillFilter]         = useState('');

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
    queryKey: ['jobs', userId, activeSkills, activeSource, experienceLevel, sortBy, page],
    queryFn: () => getJobs({
      userId: userId!,
      skills: activeSkills,
      source: activeSource,
      experienceLevel,
      sortBy,
      limit: PAGE_SIZE,
      skip:  page * PAGE_SIZE,
    }),
    enabled: !!userId,
    retry: false,
    staleTime: 0,
  });

  const jobs  = jobsQuery.data?.jobs ?? [];
  const total = jobsQuery.data?.total ?? 0;

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Listings</h1>
          <p className="text-gray-500 mt-1">All scraped jobs from your skill profile — sorted by publish date.</p>
        </div>
        {jobsQuery.isFetching && !jobsQuery.isLoading && (
          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Refreshing…
          </span>
        )}
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
            onClick={() => { setSortBy((p) => p === 'postedAt' ? 'scrapedAt' : 'postedAt'); setPage(0); }}
            className="flex items-center gap-1.5 ml-auto text-xs text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors">
            <ArrowUpDown className="w-3.5 h-3.5" />
            {sortBy === 'postedAt' ? 'Sort: Published' : 'Sort: Scraped'}
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
      {!jobsQuery.isLoading && jobs.length === 0 && (
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
      {jobs.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {jobs.map((job) => <JobCard key={job._id} job={job} />)}
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
