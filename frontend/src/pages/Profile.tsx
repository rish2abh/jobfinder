import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import {
  User,
  Mail,
  Phone,
  MapPin,
  Link2,
  GitBranch,
  Globe,
  Briefcase,
  GraduationCap,
  Award,
  Languages,
  Code2,
  Plus,
  Trash2,
  Save,
  Loader2,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Tag,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getUserProfile,
  updateUserProfile,
  extractProfileFromResume,
  type UserProfile,
  type ExperienceItem,
  type EducationItem,
  type ProjectItem,
} from '../services/api';
import { useUserStore } from '../store/userStore';

// ── Skill tag input ──────────────────────────────────────────────────────────

function SkillTagInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [input, setInput] = useState('');

  const add = () => {
    const trimmed = input.trim();
    if (!trimmed || value.includes(trimmed)) { setInput(''); return; }
    onChange([...value, trimmed]);
    setInput('');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 min-h-[2.5rem] p-2 bg-white border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent">
        {value.map((skill) => (
          <span key={skill} className="inline-flex items-center gap-1 bg-primary-100 text-primary-800 text-xs font-medium px-2.5 py-1 rounded-full">
            {skill}
            <button type="button" onClick={() => onChange(value.filter((s) => s !== skill))} aria-label={`Remove ${skill}`}>
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
          onBlur={add}
          placeholder={value.length === 0 ? 'Type a skill and press Enter…' : ''}
          className="flex-1 min-w-[120px] text-sm outline-none bg-transparent text-gray-900 placeholder-gray-400"
        />
      </div>
      <p className="text-xs text-gray-400">Press <kbd className="bg-gray-100 px-1 rounded">Enter</kbd> or <kbd className="bg-gray-100 px-1 rounded">,</kbd> to add</p>
    </div>
  );
}

// ── Collapsible section wrapper ──────────────────────────────────────────────

function Section({
  title,
  icon: Icon,
  badge,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-5 py-4 bg-gray-50 border-b border-gray-100 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-primary-500" />
          <span className="font-semibold text-gray-900 text-sm">{title}</span>
          {badge !== undefined && (
            <span className="badge bg-primary-100 text-primary-700 text-xs">{badge}</span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="p-5">{children}</div>}
    </div>
  );
}

// ── Form values type ─────────────────────────────────────────────────────────

type ProfileFormValues = {
  name: string;
  email: string;
  phone: string;
  location: string;
  headline: string;
  bio: string;
  linkedin: string;
  github: string;
  website: string;
  skills: string[];
  experience: ExperienceItem[];
  education: EducationItem[];
  certifications: string[];
  languages: string[];
  projects: ProjectItem[];
};

const emptyExp  = (): ExperienceItem => ({ company: '', title: '', startDate: '', endDate: '', description: '' });
const emptyEdu  = (): EducationItem  => ({ institution: '', degree: '', field: '', startDate: '', endDate: '' });
const emptyProj = (): ProjectItem    => ({ name: '', description: '', technologies: [] });

function profileToForm(p: UserProfile): ProfileFormValues {
  return {
    name:           p.name           ?? '',
    email:          p.email          ?? '',
    phone:          p.phone          ?? '',
    location:       p.location       ?? '',
    headline:       p.headline       ?? '',
    bio:            p.bio            ?? '',
    linkedin:       p.linkedin       ?? '',
    github:         p.github         ?? '',
    website:        p.website        ?? '',
    skills:         p.skills         ?? [],
    experience:     (p.experience    ?? []).map((e) => ({ ...emptyExp(),  ...e })),
    education:      (p.education     ?? []).map((e) => ({ ...emptyEdu(),  ...e })),
    certifications: p.certifications ?? [],
    languages:      p.languages      ?? [],
    projects:       (p.projects      ?? []).map((p) => ({ ...emptyProj(), ...p, technologies: p.technologies ?? [] })),
  };
}

// ── Main component ───────────────────────────────────────────────────────────

export default function Profile() {
  const { userId, user: storeUser, setUser } = useUserStore();
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ['profile', userId],
    queryFn:  () => getUserProfile(userId!),
    enabled:  !!userId,
    staleTime: 0,
  });

  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<ProfileFormValues>({
    defaultValues: profileToForm({
      name: storeUser?.name ?? '',
      email: storeUser?.email ?? '',
    } as UserProfile),
  });

  // Populate form once profile loads
  useEffect(() => {
    if (profileQuery.data) {
      reset(profileToForm(profileQuery.data));
    }
  }, [profileQuery.data, reset]);

  const skillsValue   = watch('skills');
  const langsValue    = watch('languages');
  const certsValue    = watch('certifications');

  // Dynamic field arrays
  const expArray  = useFieldArray({ control, name: 'experience' });
  const eduArray  = useFieldArray({ control, name: 'education' });
  const projArray = useFieldArray({ control, name: 'projects' });

  // ── Save mutation ────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: (data: ProfileFormValues) => updateUserProfile(userId!, data),
    onSuccess: (updated) => {
      toast.success('Profile saved');
      // Update zustand store name/email if changed
      if (updated && storeUser) {
        setUser({ ...storeUser, name: updated.name, email: updated.email });
      }
      queryClient.invalidateQueries({ queryKey: ['profile', userId] });
      queryClient.invalidateQueries({ queryKey: ['user',    userId] });
    },
  });

  // ── Extract-from-resume mutation ─────────────────────────────────────────

  const extractMutation = useMutation({
    mutationFn: () => extractProfileFromResume(userId!),
    onSuccess: (extracted) => {
      reset(profileToForm(extracted));
      toast.success('Profile auto-filled from resume — review and save');
    },
  });

  const onSubmit = (data: ProfileFormValues) => saveMutation.mutate(data);

  const lastUpdatedFrom = profileQuery.data?.lastUpdatedFrom;
  const lastUpdatedAt   = profileQuery.data?.updatedAt;

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Job-application info auto-filled from your resume — edit anything here.
          </p>
          {lastUpdatedFrom && (
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
              <CheckCircle className="w-3 h-3 text-green-500" />
              Last filled from&nbsp;
              <span className="font-medium">
                {lastUpdatedFrom === 'manual' ? 'manual edit'
                  : lastUpdatedFrom === 'resume_parse' ? 'AI resume parse'
                  : 'raw text extraction'}
              </span>
              {lastUpdatedAt && ` · ${new Date(lastUpdatedAt).toLocaleDateString()}`}
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => extractMutation.mutate()}
            disabled={extractMutation.isPending || profileQuery.isLoading}
            className="btn-secondary text-sm"
            title="Re-extract profile data from your uploaded resume"
          >
            {extractMutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Extracting…</>
              : <><RefreshCw className="w-4 h-4" /> Fill from Resume</>}
          </button>
        </div>
      </div>

      {/* Loading state */}
      {profileQuery.isLoading && (
        <div className="card p-12 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
        </div>
      )}

      {/* No resume warning */}
      {!profileQuery.isLoading && !profileQuery.data?.skills?.length && !profileQuery.data?.phone && (
        <div className="flex items-start gap-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p>
            Profile is empty. Upload and parse your resume, then click{' '}
            <strong>Fill from Resume</strong> to auto-populate — or fill in manually below.
          </p>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

        {/* ── Personal Info ──────────────────────────────────────────── */}
        <Section title="Personal Information" icon={User}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input className="input pl-9" placeholder="Alice Johnson" {...register('name')} />
              </div>
            </div>
            <div>
              <label className="label">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input className="input pl-9" type="email" placeholder="alice@example.com" {...register('email')} />
              </div>
            </div>
            <div>
              <label className="label">Phone</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input className="input pl-9" placeholder="+91 98765 43210" {...register('phone')} />
              </div>
            </div>
            <div>
              <label className="label">Location</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input className="input pl-9" placeholder="Bengaluru, India" {...register('location')} />
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Professional Headline</label>
              <input className="input" placeholder="Full-Stack Developer · 4 YOE · Open to Remote" {...register('headline')} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Bio / Summary</label>
              <textarea rows={3} className="input resize-none" placeholder="Passionate developer who..." {...register('bio')} />
            </div>
          </div>
        </Section>

        {/* ── Online Presence ────────────────────────────────────────── */}
        <Section title="Online Presence" icon={Globe} defaultOpen={false}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label">LinkedIn</label>
              <div className="relative">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input className="input pl-9" placeholder="https://linkedin.com/in/..." {...register('linkedin')} />
              </div>
            </div>
            <div>
              <label className="label">GitHub</label>
              <div className="relative">
                <GitBranch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input className="input pl-9" placeholder="https://github.com/..." {...register('github')} />
              </div>
            </div>
            <div>
              <label className="label">Portfolio / Website</label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input className="input pl-9" placeholder="https://yoursite.dev" {...register('website')} />
              </div>
            </div>
          </div>
        </Section>

        {/* ── Skills ─────────────────────────────────────────────────── */}
        <Section title="Skills" icon={Tag} badge={skillsValue?.length ?? 0}>
          <Controller
            control={control}
            name="skills"
            render={({ field }) => (
              <SkillTagInput value={field.value ?? []} onChange={field.onChange} />
            )}
          />
        </Section>

        {/* ── Experience ─────────────────────────────────────────────── */}
        <Section title="Work Experience" icon={Briefcase} badge={expArray.fields.length}>
          <div className="space-y-5">
            {expArray.fields.map((field, idx) => (
              <div key={field.id} className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Position {idx + 1}</span>
                  <button type="button" onClick={() => expArray.remove(idx)} className="text-red-400 hover:text-red-600 transition-colors" aria-label="Remove">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label text-xs">Job Title</label>
                    <input className="input text-sm" placeholder="Software Engineer" {...register(`experience.${idx}.title`)} />
                  </div>
                  <div>
                    <label className="label text-xs">Company</label>
                    <input className="input text-sm" placeholder="Google" {...register(`experience.${idx}.company`)} />
                  </div>
                  <div>
                    <label className="label text-xs">Start Date</label>
                    <input className="input text-sm" placeholder="Jan 2021" {...register(`experience.${idx}.startDate`)} />
                  </div>
                  <div>
                    <label className="label text-xs">End Date</label>
                    <input className="input text-sm" placeholder="Present" {...register(`experience.${idx}.endDate`)} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label text-xs">Description</label>
                    <textarea rows={2} className="input text-sm resize-none" placeholder="What you built, achieved, or led…" {...register(`experience.${idx}.description`)} />
                  </div>
                </div>
              </div>
            ))}
            <button type="button" onClick={() => expArray.append(emptyExp())} className="btn-secondary w-full text-sm">
              <Plus className="w-4 h-4" /> Add Experience
            </button>
          </div>
        </Section>

        {/* ── Education ──────────────────────────────────────────────── */}
        <Section title="Education" icon={GraduationCap} badge={eduArray.fields.length}>
          <div className="space-y-5">
            {eduArray.fields.map((field, idx) => (
              <div key={field.id} className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Entry {idx + 1}</span>
                  <button type="button" onClick={() => eduArray.remove(idx)} className="text-red-400 hover:text-red-600 transition-colors" aria-label="Remove">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="label text-xs">Institution</label>
                    <input className="input text-sm" placeholder="IIT Delhi" {...register(`education.${idx}.institution`)} />
                  </div>
                  <div>
                    <label className="label text-xs">Degree</label>
                    <input className="input text-sm" placeholder="B.Tech" {...register(`education.${idx}.degree`)} />
                  </div>
                  <div>
                    <label className="label text-xs">Field of Study</label>
                    <input className="input text-sm" placeholder="Computer Science" {...register(`education.${idx}.field`)} />
                  </div>
                  <div>
                    <label className="label text-xs">Start Year</label>
                    <input className="input text-sm" placeholder="2017" {...register(`education.${idx}.startDate`)} />
                  </div>
                  <div>
                    <label className="label text-xs">End Year</label>
                    <input className="input text-sm" placeholder="2021" {...register(`education.${idx}.endDate`)} />
                  </div>
                </div>
              </div>
            ))}
            <button type="button" onClick={() => eduArray.append(emptyEdu())} className="btn-secondary w-full text-sm">
              <Plus className="w-4 h-4" /> Add Education
            </button>
          </div>
        </Section>

        {/* ── Certifications ─────────────────────────────────────────── */}
        <Section title="Certifications" icon={Award} badge={certsValue?.length ?? 0} defaultOpen={false}>
          <Controller
            control={control}
            name="certifications"
            render={({ field }) => (
              <SkillTagInput value={field.value ?? []} onChange={field.onChange} />
            )}
          />
        </Section>

        {/* ── Languages ──────────────────────────────────────────────── */}
        <Section title="Languages" icon={Languages} badge={langsValue?.length ?? 0} defaultOpen={false}>
          <Controller
            control={control}
            name="languages"
            render={({ field }) => (
              <SkillTagInput value={field.value ?? []} onChange={field.onChange} />
            )}
          />
        </Section>

        {/* ── Projects ───────────────────────────────────────────────── */}
        <Section title="Projects" icon={Code2} badge={projArray.fields.length} defaultOpen={false}>
          <div className="space-y-5">
            {projArray.fields.map((field, idx) => (
              <div key={field.id} className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Project {idx + 1}</span>
                  <button type="button" onClick={() => projArray.remove(idx)} className="text-red-400 hover:text-red-600 transition-colors" aria-label="Remove">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="label text-xs">Project Name</label>
                    <input className="input text-sm" placeholder="JobFinder" {...register(`projects.${idx}.name`)} />
                  </div>
                  <div>
                    <label className="label text-xs">Description</label>
                    <textarea rows={2} className="input text-sm resize-none" placeholder="What it does…" {...register(`projects.${idx}.description`)} />
                  </div>
                  <div>
                    <label className="label text-xs">Technologies (comma-separated)</label>
                    <input
                      className="input text-sm"
                      placeholder="React, Node.js, MongoDB"
                      defaultValue={field.technologies?.join(', ')}
                      onChange={(e) => {
                        const techs = e.target.value.split(',').map((t) => t.trim()).filter(Boolean);
                        setValue(`projects.${idx}.technologies`, techs, { shouldDirty: true });
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
            <button type="button" onClick={() => projArray.append(emptyProj())} className="btn-secondary w-full text-sm">
              <Plus className="w-4 h-4" /> Add Project
            </button>
          </div>
        </Section>

        {/* ── Save button ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-2">
          {isDirty && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" /> Unsaved changes
            </p>
          )}
          <button
            type="submit"
            disabled={saveMutation.isPending || !isDirty}
            className="btn-primary ml-auto py-2.5 px-6"
          >
            {saveMutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              : <><Save className="w-4 h-4" /> Save Profile</>}
          </button>
        </div>

      </form>
    </div>
  );
}
