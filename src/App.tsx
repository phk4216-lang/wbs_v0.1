import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Plus, 
  Calendar, 
  Layout, 
  List, 
  ExternalLink, 
  Edit2, 
  Trash2, 
  ChevronRight, 
  ChevronDown, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  LogOut,
  User,
  Search,
  Filter,
  ArrowLeft
} from 'lucide-react';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  isSameDay, 
  addMonths, 
  subMonths, 
  isWithinInterval, 
  parseISO,
  differenceInDays,
  startOfDay,
  startOfYear,
  endOfYear,
  eachMonthOfInterval,
  isToday
} from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  db, 
  auth, 
  signIn, 
  logOut, 
  OperationType, 
  handleFirestoreError 
} from './firebase';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy, 
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';

// --- Types ---

type ProjectStatus = '대기' | '진행중' | '완료';
type Category = '주요과제' | '서스테이닝';
type TaskStatus = 'Todo' | 'In Progress' | 'Done';

interface Project {
  id: string;
  name: string;
  po: string;
  pd: string;
  beDev: string;
  feDev: string;
  status: ProjectStatus;
  startDate?: string;
  endDate?: string;
  planningStart?: string;
  planningEnd?: string;
  designStart?: string;
  designEnd?: string;
  devStart?: string;
  devEnd?: string;
  qaStart?: string;
  qaEnd?: string;
  deployStart?: string;
  deployEnd?: string;
  category: Category;
  order: number;
  notionLink: string;
  memo?: string;
  ownerId: string;
  createdAt?: any;
}

interface Task {
  id: string;
  projectId: string;
  title: string;
  assignee: string;
  startDate: string;
  endDate: string;
  status: TaskStatus;
  progress: number;
  ownerId: string;
}

// --- Utilities ---

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Components ---

const ErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      try {
        const parsed = JSON.parse(event.message);
        setError(parsed.error || 'An unexpected error occurred');
      } catch {
        setError(event.message);
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-red-100">
          <div className="flex items-center gap-3 text-red-600 mb-4">
            <AlertCircle className="w-8 h-8" />
            <h2 className="text-xl font-bold">System Error</h2>
          </div>
          <p className="text-slate-600 mb-6">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors"
          >
            Reload Application
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

const Badge = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <span className={cn("px-1.5 py-0 rounded-md text-[10px] font-bold uppercase tracking-tight", className)}>
    {children}
  </span>
);

const StatusBadge = ({ status }: { status: ProjectStatus | TaskStatus }) => {
  const styles: Record<string, string> = {
    '대기': 'bg-blue-100 text-blue-700',
    '진행중': 'bg-amber-100 text-amber-700',
    '완료': 'bg-emerald-100 text-emerald-700',
    'Todo': 'bg-slate-100 text-slate-700',
    'In Progress': 'bg-amber-100 text-amber-700',
    'Done': 'bg-emerald-100 text-emerald-700',
  };
  return <Badge className={styles[status] || styles['Todo']}>{status}</Badge>;
};

const CategoryBadge = ({ category }: { category: Category }) => {
  const styles = {
    '주요과제': 'bg-indigo-100 text-indigo-600',
    '서스테이닝': 'bg-slate-100 text-slate-600',
  };
  return <Badge className={styles[category]}>{category}</Badge>;
};

const OrderBadge = ({ order }: { order: number }) => (
  <Badge className="bg-slate-50 text-slate-500 border border-slate-200/50">
    {order}순위
  </Badge>
);

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<'timeline'>('timeline');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'project' | 'task'>('project');
  const [editingItem, setEditingItem] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAssignee, setSelectedAssignee] = useState<string>('');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [isSummaryView, setIsSummaryView] = useState(false);
  const timelineScrollRef = useRef<HTMLDivElement>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Data Listeners
  useEffect(() => {
    const qProjects = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    const unsubProjects = onSnapshot(qProjects, (snapshot) => {
      setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'projects'));

    const qTasks = query(collection(db, 'tasks'));
    const unsubTasks = onSnapshot(qTasks, (snapshot) => {
      setTasks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'tasks'));

    return () => {
      unsubProjects();
      unsubTasks();
    };
  }, []);

  const allAssignees = useMemo(() => {
    const assignees = new Set<string>();
    projects.forEach(p => {
      [p.po, p.pd, p.beDev, p.feDev].forEach(field => {
        if (field) {
          field.split(',').forEach(name => {
            const trimmed = name.trim();
            if (trimmed) assignees.add(trimmed);
          });
        }
      });
    });
    return Array.from(assignees).sort();
  }, [projects]);

  const filteredProjects = useMemo(() => {
    return projects
      .filter(p => {
        const matchesSearch = 
          p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.po.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.pd.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.beDev.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.feDev.toLowerCase().includes(searchTerm.toLowerCase());
        
        const matchesAssignee = !selectedAssignee || [p.po, p.pd, p.beDev, p.feDev].some(field => {
          if (!field) return false;
          return field.split(',').map(n => n.trim()).includes(selectedAssignee);
        });

        return matchesSearch && matchesAssignee;
      })
      .sort((a, b) => {
        // 1. Priority (order)
        if ((a.order || 0) !== (b.order || 0)) {
          return (a.order || 0) - (b.order || 0);
        }

        // 2. Status (진행중 > 대기 > 완료)
        const statusPriority: Record<string, number> = {
          '진행중': 1,
          '대기': 2,
          '완료': 3
        };
        const statusDiff = (statusPriority[a.status] || 99) - (statusPriority[b.status] || 99);
        if (statusDiff !== 0) return statusDiff;

        // 3. Start Date (Earliest first)
        const getStart = (p: Project) => {
          const dates = [
            p.startDate, p.planningStart, p.designStart, p.devStart, p.qaStart, p.deployStart
          ].filter(Boolean) as string[];
          return dates.length > 0 ? dates.sort()[0] : '9999-12-31';
        };
        return getStart(a).localeCompare(getStart(b));
      });
  }, [projects, searchTerm, selectedAssignee]);

  const selectedProject = useMemo(() => 
    projects.find(p => p.id === selectedProjectId), 
    [projects, selectedProjectId]
  );

  const projectTasks = useMemo(() => 
    tasks.filter(t => t.projectId === selectedProjectId), 
    [tasks, selectedProjectId]
  );

  // Scroll to today on load or view change
  useEffect(() => {
    const scrollToToday = () => {
      if (timelineScrollRef.current && projects.length > 0) {
        const today = new Date();
        const yearStart = startOfYear(currentMonth);
        
        if (today.getFullYear() === currentMonth.getFullYear()) {
          let scrollLeft = 0;
          if (isSummaryView) {
            const monthIdx = today.getMonth();
            scrollLeft = monthIdx * 120;
          } else {
            const daysDiff = differenceInDays(startOfDay(today), startOfDay(yearStart));
            scrollLeft = daysDiff * 32;
          }
          
          // Center today in the view if possible
          const containerWidth = timelineScrollRef.current.clientWidth;
          const targetScroll = Math.max(0, scrollLeft - ((containerWidth - 256) / 2));
          
          timelineScrollRef.current.scrollLeft = targetScroll;
        }
      }
    };

    // Use requestAnimationFrame to ensure DOM is updated
    const rafId = requestAnimationFrame(() => {
      // Small delay to ensure layout is stable
      setTimeout(scrollToToday, 100);
    });

    return () => cancelAnimationFrame(rafId);
  }, [projects.length, isSummaryView, currentMonth.getFullYear()]);

  // Handlers
  const handleSaveProject = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const planningStart = formData.get('planningStart') as string;
    const planningEnd = formData.get('planningEnd') as string;
    const designStart = formData.get('designStart') as string;
    const designEnd = formData.get('designEnd') as string;
    const devStart = formData.get('devStart') as string;
    const devEnd = formData.get('devEnd') as string;
    const qaStart = formData.get('qaStart') as string;
    const qaEnd = formData.get('qaEnd') as string;
    const deployStart = formData.get('deployStart') as string;
    const deployEnd = formData.get('deployEnd') as string;

    const dates = [
      planningStart, planningEnd,
      designStart, designEnd,
      devStart, devEnd,
      qaStart, qaEnd,
      deployStart, deployEnd
    ].filter(Boolean).sort();

    const data = {
      name: formData.get('name') as string,
      po: formData.get('po') as string,
      pd: formData.get('pd') as string,
      beDev: formData.get('beDev') as string,
      feDev: formData.get('feDev') as string,
      status: formData.get('status') as ProjectStatus,
      category: formData.get('category') as Category,
      order: Number(formData.get('order')),
      startDate: dates.length > 0 ? dates[0] : null,
      endDate: dates.length > 0 ? dates[dates.length - 1] : null,
      planningStart,
      planningEnd,
      designStart,
      designEnd,
      devStart,
      devEnd,
      qaStart,
      qaEnd,
      deployStart,
      deployEnd,
      notionLink: formData.get('notionLink') as string,
      memo: formData.get('memo') as string,
      ownerId: user?.uid || 'public',
    };

    try {
      if (editingItem) {
        await updateDoc(doc(db, 'projects', editingItem.id), data);
      } else {
        await addDoc(collection(db, 'projects'), { ...data, createdAt: serverTimestamp() });
      }
      setIsModalOpen(false);
      setEditingItem(null);
    } catch (err) {
      handleFirestoreError(err, editingItem ? OperationType.UPDATE : OperationType.CREATE, 'projects');
    }
  };

  const handleSaveTask = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    const formData = new FormData(e.currentTarget);
    const data = {
      projectId: selectedProjectId,
      title: formData.get('title') as string,
      assignee: formData.get('assignee') as string,
      startDate: formData.get('startDate') as string,
      endDate: formData.get('endDate') as string,
      status: formData.get('status') as TaskStatus,
      progress: Number(formData.get('progress')),
      ownerId: user?.uid || 'public',
    };

    try {
      if (editingItem) {
        await updateDoc(doc(db, 'tasks', editingItem.id), data);
      } else {
        await addDoc(collection(db, 'tasks'), data);
      }
      setIsModalOpen(false);
      setEditingItem(null);
    } catch (err) {
      handleFirestoreError(err, editingItem ? OperationType.UPDATE : OperationType.CREATE, 'tasks');
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this project?')) return;
    try {
      await deleteDoc(doc(db, 'projects', id));
      if (selectedProjectId === id) {
        setSelectedProjectId(null);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'projects');
    }
  };

  const handleDeleteTask = async (id: string) => {
    if (!window.confirm('Delete this task?')) return;
    try {
      await deleteDoc(doc(db, 'tasks', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'tasks');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen flex flex-col">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-100">
                <Layout className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-xl font-bold text-slate-900 hidden sm:block">Project Hub</h1>
            </div>

            <div className="flex items-center gap-4">
              {user ? (
                <div className="flex items-center gap-3">
                  <div className="text-right hidden sm:block">
                    <p className="text-sm font-semibold text-slate-900">{user.displayName}</p>
                    <p className="text-xs text-slate-500">{user.email}</p>
                  </div>
                  <button 
                    onClick={logOut}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                    title="Sign Out"
                  >
                    <LogOut className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <button 
                  onClick={signIn}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-all flex items-center gap-2"
                >
                  <User className="w-4 h-4" />
                  Sign In
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
          <AnimatePresence mode="wait">
            {view === 'timeline' && (
              <motion.div 
                key="timeline"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="space-y-6 flex flex-col"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">Annual Timeline</h2>
                    <p className="text-slate-500">Yearly overview of all project schedules</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input 
                        type="text"
                        placeholder="Search projects..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 w-full sm:w-48"
                      />
                    </div>
                    <div className="relative">
                      <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <select 
                        value={selectedAssignee}
                        onChange={(e) => setSelectedAssignee(e.target.value)}
                        className="pl-10 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 w-full sm:w-40 appearance-none cursor-pointer"
                      >
                        <option value="">All Assignees</option>
                        {allAssignees.map(name => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                      <ChevronDown className="w-3 h-3 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                    <button 
                      onClick={() => {
                        setModalType('project');
                        setEditingItem(null);
                        setIsModalOpen(true);
                      }}
                      className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-medium hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-lg shadow-indigo-100"
                    >
                      <Plus className="w-4 h-4" />
                      New Project
                    </button>
                    <div className="h-8 w-px bg-slate-200 mx-1 hidden sm:block" />
                    <button 
                      onClick={() => setIsSummaryView(!isSummaryView)}
                      className={cn(
                        "px-4 py-2 border rounded-xl text-sm font-medium transition-all shadow-sm",
                        isSummaryView 
                          ? "bg-indigo-600 border-indigo-600 text-white" 
                          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                      )}
                    >
                      {isSummaryView ? 'Detailed' : 'Summary'}
                    </button>
                    <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
                      <button 
                        onClick={() => setCurrentMonth(subMonths(currentMonth, 12))}
                        className="p-2 hover:bg-slate-50 rounded-lg transition-all text-slate-500"
                        title="Previous Year"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      <span className="px-6 font-bold text-slate-700 min-w-[100px] text-center">
                        {format(currentMonth, 'yyyy')}
                      </span>
                      <button 
                        onClick={() => setCurrentMonth(addMonths(currentMonth, 12))}
                        className="p-2 hover:bg-slate-50 rounded-lg transition-all text-slate-500"
                        title="Next Year"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col">
                  <div 
                    ref={timelineScrollRef}
                    className="overflow-x-auto overflow-y-hidden relative scroll-smooth"
                  >
                    <div className="inline-block min-w-full">
                      {/* Timeline Header */}
                      <div className="sticky top-0 z-20 bg-white">
                        {/* Month Row */}
                        <div className="flex border-b border-slate-200">
                          <div className="w-64 shrink-0 p-4 font-bold text-slate-400 text-xs uppercase tracking-wider border-r border-slate-200 bg-slate-50/50 sticky left-0 z-30">Project</div>
                          <div className="flex">
                            {eachMonthOfInterval({
                              start: startOfYear(currentMonth),
                              end: endOfYear(currentMonth)
                            }).map(month => {
                              const days = eachDayOfInterval({
                                start: startOfMonth(month),
                                end: endOfMonth(month)
                              });
                              const monthWidth = isSummaryView ? 120 : days.length * 32;
                              return (
                                <div 
                                  key={month.toString()} 
                                  className="shrink-0 border-r border-slate-200 bg-slate-50/30"
                                  style={{ width: `${monthWidth}px` }}
                                >
                                  <div className={cn(
                                    "px-4 py-2 text-xs font-bold text-slate-600",
                                    !isSummaryView && "border-b border-slate-100"
                                  )}>
                                    {format(month, 'MMM')}
                                  </div>
                                  {!isSummaryView && (
                                    <div className="flex">
                                      {days.map(day => (
                                        <div 
                                          key={day.toString()} 
                                          className={cn(
                                            "w-8 shrink-0 text-center py-2 text-[9px] font-bold border-r border-slate-100 last:border-r-0",
                                            [0, 6].includes(day.getDay()) ? "bg-slate-100/50 text-slate-400" : "text-slate-500",
                                            isToday(day) && "bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-200"
                                          )}
                                        >
                                          {format(day, 'd')}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Timeline Rows */}
                      <div className="divide-y divide-slate-100">
                        {filteredProjects.map(project => {
                          const allDates = [
                            project.planningStart, project.planningEnd,
                            project.designStart, project.designEnd,
                            project.devStart, project.devEnd,
                            project.qaStart, project.qaEnd,
                            project.deployStart, project.deployEnd
                          ].filter(Boolean).sort();
                          
                          const start = allDates.length > 0 ? parseISO(allDates[0]) : null;
                          const end = allDates.length > 0 ? parseISO(allDates[allDates.length - 1]) : null;
                          const yearStart = startOfYear(currentMonth);
                          const yearEnd = endOfYear(currentMonth);

                          return (
                            <div 
                              key={project.id} 
                              className="flex group hover:bg-slate-50/30 transition-colors cursor-pointer"
                              onClick={() => {
                                setSelectedProjectId(project.id);
                              }}
                            >
                              <div className="w-64 shrink-0 p-4 border-r border-slate-200 flex flex-col justify-center sticky left-0 z-10 bg-white group-hover:bg-slate-50 transition-colors">
                                <div className="flex items-center justify-between mb-1.5">
                                  <div className="flex items-center gap-2">
                                    <StatusBadge status={project.status} />
                                    <CategoryBadge category={project.category} />
                                    <OrderBadge order={project.order} />
                                  </div>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteProject(project.id);
                                    }}
                                    className="p-1 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded transition-all opacity-0 group-hover:opacity-100"
                                    title="Delete Project"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                <span 
                                  className="font-bold text-slate-700 truncate text-sm hover:text-indigo-600 cursor-pointer transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setModalType('project');
                                    setEditingItem(project);
                                    setIsModalOpen(true);
                                  }}
                                >
                                  {project.name}
                                </span>
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                                  <span className="text-[10px] text-slate-400 truncate max-w-[180px]">
                                    {[project.po, project.pd, project.beDev, project.feDev].filter(Boolean).join(', ')}
                                  </span>
                                </div>
                                <div className="text-[9px] text-slate-400 mt-1 font-medium flex items-center gap-1.5">
                                  <span>
                                    {start ? format(start, 'yyyy.MM.dd') : '-'} ~ {end ? format(end, 'yyyy.MM.dd') : '미정'}
                                  </span>
                                  {project.deployEnd && (
                                    <span className="text-indigo-500 font-bold">
                                      (배포일 : {format(parseISO(project.deployEnd), 'MM.dd')})
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className={cn("flex relative group/row", isSummaryView ? "h-12" : "h-16")}>
                                {/* Background Grid */}
                                {eachMonthOfInterval({
                                  start: yearStart,
                                  end: yearEnd
                                }).map(month => {
                                  const days = eachDayOfInterval({
                                    start: startOfMonth(month),
                                    end: endOfMonth(month)
                                  });
                                  const monthWidth = isSummaryView ? 120 : days.length * 32;
                                  return (
                                    <div 
                                      key={month.toString()} 
                                      className={cn(
                                        "shrink-0 border-r border-slate-50 last:border-r-0 relative",
                                        isSummaryView && "bg-slate-50/10"
                                      )}
                                      style={{ width: `${monthWidth}px` }}
                                    >
                                      {!isSummaryView && (
                                        <div className="flex h-full">
                                          {days.map(day => {
                                            const isDayToday = isToday(day);
                                            return (
                                              <div 
                                                key={day.toString()} 
                                                className={cn(
                                                  "w-8 shrink-0 border-r border-slate-50/50 last:border-r-0 relative",
                                                  [0, 6].includes(day.getDay()) ? "bg-slate-50/30" : "",
                                                  isDayToday && "bg-indigo-50/20"
                                                )}
                                              >
                                                {isDayToday && <div className="absolute inset-y-0 w-px bg-indigo-200 z-0" />}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}

                                {/* Phase Bars Overlay */}
                                <div className="absolute inset-0 pointer-events-none flex flex-col justify-center gap-0.5 px-0.5">
                                  {[
                                    { label: '기획', start: project.planningStart, end: project.planningEnd, color: 'bg-blue-500' },
                                    { label: '디자인', start: project.designStart, end: project.designEnd, color: 'bg-purple-500' },
                                    { label: '개발', start: project.devStart, end: project.devEnd, color: 'bg-amber-500' },
                                    { label: 'QA', start: project.qaStart, end: project.qaEnd, color: 'bg-pink-500' },
                                    { label: '배포', start: project.deployStart, end: project.deployEnd, color: 'bg-emerald-500' },
                                  ].map((phase, idx) => {
                                    if (!phase.start || !phase.end) return null;
                                    const pStart = parseISO(phase.start);
                                    const pEnd = parseISO(phase.end);
                                    
                                    let marginLeft = 0;
                                    let width = 0;

                                    if (isSummaryView) {
                                      const months = eachMonthOfInterval({ start: yearStart, end: yearEnd });
                                      const startMonthIdx = months.findIndex(m => m.getFullYear() === pStart.getFullYear() && m.getMonth() === pStart.getMonth());
                                      const endMonthIdx = months.findIndex(m => m.getFullYear() === pEnd.getFullYear() && m.getMonth() === pEnd.getMonth());
                                      
                                      const daysInStartMonth = eachDayOfInterval({ start: startOfMonth(pStart), end: endOfMonth(pStart) }).length;
                                      const daysInEndMonth = eachDayOfInterval({ start: startOfMonth(pEnd), end: endOfMonth(pEnd) }).length;

                                      // Handle dates outside current year
                                      const startPos = startMonthIdx === -1 
                                        ? (pStart < yearStart ? 0 : 12 * 120)
                                        : (startMonthIdx * 120) + ((pStart.getDate() - 1) / daysInStartMonth) * 120;
                                      
                                      const endPos = endMonthIdx === -1
                                        ? (pEnd < yearStart ? 0 : 12 * 120)
                                        : (endMonthIdx * 120) + (pEnd.getDate() / daysInEndMonth) * 120;

                                      marginLeft = startPos;
                                      width = Math.max(0, endPos - startPos);
                                    } else {
                                      const offsetDays = differenceInDays(pStart, yearStart);
                                      const durationDays = differenceInDays(pEnd, pStart) + 1;
                                      marginLeft = offsetDays * 32;
                                      width = durationDays * 32;
                                    }
                                    
                                    return (
                                      <div 
                                        key={idx}
                                        className={cn(
                                          "rounded-full opacity-80 pointer-events-auto group/phase relative transition-all hover:opacity-100 hover:scale-y-110",
                                          isSummaryView ? "h-1.5" : "h-2",
                                          phase.color
                                        )}
                                        style={{
                                          marginLeft: `${marginLeft}px`,
                                          width: `${width}px`
                                        }}
                                      >
                                        {/* Tooltip */}
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-slate-900 text-white text-[10px] rounded opacity-0 group-hover/phase:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-xl">
                                          {phase.label} ({format(pStart, 'yyyy.MM.dd')}~{format(pEnd, 'yyyy.MM.dd')})
                                        </div>
                                      </div>
                                    );
                                  })}

                                  {/* Overall Bar */}
                                  {start && end && (
                                    <div 
                                      className={cn(
                                        "rounded-xl opacity-20 pointer-events-auto",
                                        isSummaryView ? "h-3" : "h-4",
                                        project.status === '완료' ? "bg-emerald-400" : "bg-indigo-500"
                                      )}
                                      style={(() => {
                                        if (isSummaryView) {
                                          const months = eachMonthOfInterval({ start: yearStart, end: yearEnd });
                                          const startMonthIdx = months.findIndex(m => m.getFullYear() === start.getFullYear() && m.getMonth() === start.getMonth());
                                          const endMonthIdx = months.findIndex(m => m.getFullYear() === end.getFullYear() && m.getMonth() === end.getMonth());
                                          
                                          const daysInStartMonth = eachDayOfInterval({ start: startOfMonth(start), end: endOfMonth(start) }).length;
                                          const daysInEndMonth = eachDayOfInterval({ start: startOfMonth(end), end: endOfMonth(end) }).length;

                                          const startPos = startMonthIdx === -1 
                                            ? (start < yearStart ? 0 : 12 * 120)
                                            : (startMonthIdx * 120) + ((start.getDate() - 1) / daysInStartMonth) * 120;
                                          
                                          const endPos = endMonthIdx === -1
                                            ? (end < yearStart ? 0 : 12 * 120)
                                            : (endMonthIdx * 120) + (end.getDate() / daysInEndMonth) * 120;

                                          return {
                                            marginLeft: `${startPos}px`,
                                            width: `${Math.max(0, endPos - startPos)}px`
                                          };
                                        }
                                        return {
                                          marginLeft: `${differenceInDays(start, yearStart) * 32}px`,
                                          width: `${(differenceInDays(end, start) + 1) * 32}px`
                                        };
                                      })()}
                                    />
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {filteredProjects.length === 0 && (
                          <div className="p-12 text-center text-slate-400 italic">
                            No projects found. Add a project to see it on the timeline.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Project Detail Modal */}
        <AnimatePresence>
          {selectedProjectId && selectedProject && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 lg:p-8">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSelectedProjectId(null)}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 40 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 40 }}
                className="relative bg-slate-50 rounded-[2.5rem] shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-white/20"
              >
                {/* Modal Header */}
                <div className="px-8 py-6 bg-white border-b border-slate-100 flex items-center justify-between sticky top-0 z-10">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-100">
                      <Layout className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900 leading-tight">{selectedProject.name}</h2>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Order: {selectedProject.order}</span>
                        <StatusBadge status={selectedProject.status} />
                        <CategoryBadge category={selectedProject.category} />
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => setSelectedProjectId(null)}
                    className="p-3 hover:bg-slate-100 rounded-2xl transition-all text-slate-400 hover:text-slate-600 group"
                  >
                    <Plus className="w-8 h-8 rotate-45 group-hover:scale-110 transition-transform" />
                  </button>
                </div>

                {/* Modal Content */}
                <div className="p-8 overflow-y-auto flex-1 space-y-8 custom-scrollbar">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Left Column: Info & Timeline */}
                    <div className="space-y-6">
                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">Project Info</h3>
                        <div className="space-y-5">
                          {[
                            { label: 'PO', value: selectedProject.po },
                            { label: 'PD', value: selectedProject.pd },
                            { label: 'BE Developer', value: selectedProject.beDev },
                            { label: 'FE Developer', value: selectedProject.feDev },
                          ].map(item => (
                            <div key={item.label} className="flex items-center justify-between group">
                              <span className="text-slate-400 text-sm font-medium">{item.label}</span>
                              <span className="font-bold text-slate-800 group-hover:text-indigo-600 transition-colors">{item.value || '-'}</span>
                            </div>
                          ))}
                          <div className="pt-6 border-t border-slate-100">
                            <a 
                              href={selectedProject.notionLink} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="flex items-center justify-center gap-3 w-full py-4 bg-slate-900 text-white rounded-2xl text-sm font-bold hover:bg-indigo-600 transition-all shadow-lg shadow-slate-200"
                            >
                              <ExternalLink className="w-4 h-4" />
                              Open Notion Page
                            </a>
                          </div>
                        </div>
                      </div>

                      <div className="bg-indigo-600 rounded-3xl p-8 text-white shadow-2xl shadow-indigo-200 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                          <Calendar className="w-24 h-24" />
                        </div>
                        <h3 className="text-xs font-bold opacity-70 uppercase tracking-widest mb-6 relative z-10">Timeline</h3>
                        <div className="flex items-center gap-5 relative z-10">
                          <div className="p-4 bg-white/20 rounded-2xl backdrop-blur-md">
                            <Calendar className="w-8 h-8" />
                          </div>
                          <div>
                            <p className="text-xl font-black tracking-tight">
                              {selectedProject.startDate ? format(parseISO(selectedProject.startDate), 'yyyy.MM.dd') : '-'}
                              <span className="mx-2 opacity-50">→</span>
                              {selectedProject.endDate ? format(parseISO(selectedProject.endDate), 'yyyy.MM.dd') : '미정'}
                            </p>
                            <p className="text-xs font-bold opacity-70 mt-1 uppercase tracking-wider">
                              {selectedProject.startDate && selectedProject.endDate ? differenceInDays(parseISO(selectedProject.endDate), parseISO(selectedProject.startDate)) : 0} Days Duration
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Memo & Phases */}
                    <div className="space-y-6">
                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <div className="flex items-center justify-between mb-6">
                          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Project Memo</h3>
                          <span className="text-[10px] text-slate-400 font-bold italic uppercase tracking-tighter">Auto-saves</span>
                        </div>
                        <textarea 
                          key={selectedProject.id}
                          defaultValue={selectedProject.memo}
                          onBlur={async (e) => {
                            const newMemo = e.target.value;
                            if (newMemo !== (selectedProject.memo || '')) {
                              try {
                                await updateDoc(doc(db, 'projects', selectedProject.id), { memo: newMemo });
                              } catch (err) {
                                handleFirestoreError(err, OperationType.UPDATE, `projects/${selectedProject.id}`);
                              }
                            }
                          }}
                          className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all min-h-[150px] text-sm text-slate-600 whitespace-pre-wrap resize-none leading-relaxed" 
                          placeholder="Add project notes, links, or details here..."
                        />
                      </div>

                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">Phase Schedules</h3>
                        <div className="space-y-4">
                          {[
                            { label: '기획 (Planning)', start: selectedProject.planningStart, end: selectedProject.planningEnd, color: 'text-blue-600', bg: 'bg-blue-50' },
                            { label: '디자인 (Design)', start: selectedProject.designStart, end: selectedProject.designEnd, color: 'text-purple-600', bg: 'bg-purple-50' },
                            { label: '개발 (Development)', start: selectedProject.devStart, end: selectedProject.devEnd, color: 'text-amber-600', bg: 'bg-amber-50' },
                            { label: 'QA', start: selectedProject.qaStart, end: selectedProject.qaEnd, color: 'text-pink-600', bg: 'bg-pink-50' },
                            { label: '배포 (Deployment)', start: selectedProject.deployStart, end: selectedProject.deployEnd, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                          ].map(phase => (
                            <div key={phase.label} className="flex flex-col gap-1 p-4 rounded-2xl bg-slate-50 border border-slate-100 group hover:border-indigo-200 transition-all">
                              <span className={cn("text-[10px] font-black uppercase tracking-widest", phase.color)}>{phase.label}</span>
                              <span className="text-sm text-slate-800 font-bold">
                                {phase.start ? format(parseISO(phase.start), 'yyyy.MM.dd') : '-'} ~ {phase.end ? format(parseISO(phase.end), 'yyyy.MM.dd') : '-'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Modals */}
        <AnimatePresence>
          {isModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsModalOpen(false)}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
              >
                <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <h3 className="text-xl font-bold text-slate-900">
                    {editingItem ? 'Edit' : 'New'} {modalType === 'project' ? 'Project' : 'Task'}
                  </h3>
                  <button 
                    onClick={() => setIsModalOpen(false)}
                    className="p-2 hover:bg-white rounded-xl transition-all text-slate-400"
                  >
                    <Plus className="w-6 h-6 rotate-45" />
                  </button>
                </div>

                <form onSubmit={modalType === 'project' ? handleSaveProject : handleSaveTask} className="p-8 overflow-y-auto flex-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {modalType === 'project' ? (
                      <>
                        <div className="sm:col-span-2">
                          <label className="block text-sm font-bold text-slate-700 mb-2">Project Name</label>
                          <input 
                            name="name" 
                            required 
                            defaultValue={editingItem?.name}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                            placeholder="e.g. Mobile App Redesign"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-2">PO</label>
                          <input name="po" required defaultValue={editingItem?.po} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-2">PD (Optional)</label>
                          <input name="pd" defaultValue={editingItem?.pd} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-2">BE Dev</label>
                          <input name="beDev" defaultValue={editingItem?.beDev} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-2">FE Dev</label>
                          <input name="feDev" defaultValue={editingItem?.feDev} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-2">Status</label>
                          <select name="status" defaultValue={editingItem?.status || '대기'} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all">
                            <option>대기</option>
                            <option>진행중</option>
                            <option>완료</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-2">Category</label>
                          <select name="category" defaultValue={editingItem?.category || '주요과제'} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all">
                            <option>주요과제</option>
                            <option>서스테이닝</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-2">Order (1-10)</label>
                          <select name="order" defaultValue={editingItem?.order || 1} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all">
                            {[1,2,3,4,5,6,7,8,9,10].map(n => (
                              <option key={n} value={n}>{n}</option>
                            ))}
                          </select>
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-sm font-bold text-slate-700 mb-2">Notion Link</label>
                          <input name="notionLink" defaultValue={editingItem?.notionLink} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all" placeholder="https://notion.so/..." />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-sm font-bold text-slate-700 mb-2">Memo</label>
                          <textarea 
                            name="memo" 
                            defaultValue={editingItem?.memo} 
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all min-h-[120px]" 
                            placeholder="Add project notes, links, or details here..."
                          />
                        </div>

                        {/* Phase Dates */}
                        <div className="sm:col-span-2 border-t border-slate-100 pt-6 mt-2">
                          <h4 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-indigo-500" />
                            Phase Schedules
                          </h4>
                          <div className="grid grid-cols-1 gap-4">
                            {[
                              { label: '기획/검토 (Planning)', start: 'planningStart', end: 'planningEnd', color: 'blue', bg: 'bg-blue-50/30', border: 'border-blue-100', text: 'text-blue-600' },
                              { label: '디자인 (Design)', start: 'designStart', end: 'designEnd', color: 'purple', bg: 'bg-purple-50/30', border: 'border-purple-100', text: 'text-purple-600' },
                              { label: '개발 (Development)', start: 'devStart', end: 'devEnd', color: 'amber', bg: 'bg-amber-50/30', border: 'border-amber-100', text: 'text-amber-600' },
                              { label: 'QA', start: 'qaStart', end: 'qaEnd', color: 'pink', bg: 'bg-pink-50/30', border: 'border-pink-100', text: 'text-pink-600' },
                              { label: '배포 (Deployment)', start: 'deployStart', end: 'deployEnd', color: 'emerald', bg: 'bg-emerald-50/30', border: 'border-emerald-100', text: 'text-emerald-600' },
                            ].map(phase => (
                              <div key={phase.start} className={cn("p-4 rounded-2xl border", phase.bg, phase.border)}>
                                <label className={cn("block text-xs font-bold uppercase tracking-wider mb-2", phase.text)}>{phase.label}</label>
                                <div className="grid grid-cols-2 gap-4">
                                  <input name={phase.start} type="date" defaultValue={editingItem?.[phase.start as keyof Project] as string} className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none" />
                                  <input name={phase.end} type="date" defaultValue={editingItem?.[phase.end as keyof Project] as string} className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none" />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="sm:col-span-2">
                          <label className="block text-sm font-bold text-slate-700 mb-2">Task Title</label>
                          <input name="title" required defaultValue={editingItem?.title} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all" placeholder="e.g. API Integration" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-2">Assignee</label>
                          <input name="assignee" required defaultValue={editingItem?.assignee} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-2">Status</label>
                          <select name="status" defaultValue={editingItem?.status || 'Todo'} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all">
                            <option>Todo</option>
                            <option>In Progress</option>
                            <option>Done</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-2">Start Date</label>
                          <input type="date" name="startDate" required defaultValue={editingItem?.startDate} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-2">End Date</label>
                          <input type="date" name="endDate" required defaultValue={editingItem?.endDate} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-sm font-bold text-slate-700 mb-2">Progress ({editingItem?.progress || 0}%)</label>
                          <input type="range" name="progress" min="0" max="100" defaultValue={editingItem?.progress || 0} className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
                        </div>
                      </>
                    )}
                  </div>

                  <div className="mt-10 flex gap-4">
                    <button 
                      type="button" 
                      onClick={() => setIsModalOpen(false)}
                      className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-bold hover:bg-slate-200 transition-all"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit"
                      className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100"
                    >
                      {editingItem ? 'Update' : 'Create'} {modalType === 'project' ? 'Project' : 'Task'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}
