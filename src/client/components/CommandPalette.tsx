import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Home, 
  Users, 
  Trophy, 
  Grid3x3, 
  Target, 
  Settings, 
  HelpCircle,
  ClipboardCheck,
  BarChart3,
  Calendar,
  FileText,
  Trash2,
  Search,
  ChevronRight,
  Command,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  action: () => void;
  keywords?: string[];
  requiresAuth?: boolean;
  requiresRole?: string[];
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, hasRole } = useAuth();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: CommandItem[] = useMemo(() => [
    {
      id: 'dashboard',
      label: 'Dashboard',
      description: 'View tournament overview',
      icon: Home,
      action: () => navigate('/'),
      keywords: ['home', 'overview'],
      requiresAuth: true,
    },
    {
      id: 'tournaments',
      label: 'Tournaments',
      description: 'Manage tournaments',
      icon: Trophy,
      action: () => navigate('/tournaments'),
      keywords: ['events', 'competitions'],
      requiresAuth: true,
    },
    {
      id: 'competitors',
      label: 'Competitors',
      description: 'Manage competitor registry',
      icon: Users,
      action: () => navigate('/competitors'),
      keywords: ['participants', 'athletes', 'registry'],
      requiresAuth: true,
    },
    {
      id: 'divisions',
      label: 'Divisions',
      description: 'View divisions (requires active tournament)',
      icon: Grid3x3,
      action: () => {
        const tournamentId = new URLSearchParams(location.search).get('tournamentId') || 
                           location.pathname.match(/\/tournaments\/([^/]+)/)?.[1];
        if (tournamentId) {
          navigate(`/tournaments/${tournamentId}/divisions`);
        }
      },
      keywords: ['categories', 'groups'],
      requiresAuth: true,
    },
    {
      id: 'brackets',
      label: 'Brackets',
      description: 'Manage brackets (requires active tournament)',
      icon: Target,
      action: () => {
        const tournamentId = location.pathname.match(/\/tournaments\/([^/]+)/)?.[1];
        if (tournamentId) {
          navigate(`/tournaments/${tournamentId}/divisions`);
        }
      },
      keywords: ['matches', 'draws'],
      requiresAuth: true,
    },
    {
      id: 'scorekeeper',
      label: 'Scorekeeper',
      description: 'Live scoring (requires active tournament)',
      icon: Target,
      action: () => {
        const tournamentId = location.pathname.match(/\/tournaments\/([^/]+)/)?.[1];
        if (tournamentId) {
          navigate(`/tournaments/${tournamentId}/scorekeeper`);
        }
      },
      keywords: ['scoring', 'live', 'matches'],
      requiresAuth: true,
      requiresRole: ['admin', 'director', 'scorekeeper'],
    },
    {
      id: 'checkin',
      label: 'Check-in',
      description: 'Competitor check-in (requires active tournament)',
      icon: ClipboardCheck,
      action: () => {
        const tournamentId = location.pathname.match(/\/tournaments\/([^/]+)/)?.[1];
        if (tournamentId) {
          navigate(`/tournaments/${tournamentId}/checkin`);
        }
      },
      keywords: ['registration', 'weigh-in'],
      requiresAuth: true,
      requiresRole: ['admin', 'director', 'scorekeeper'],
    },
    {
      id: 'director-dashboard',
      label: 'Director Dashboard',
      description: 'Command center (requires active tournament)',
      icon: BarChart3,
      action: () => {
        const tournamentId = location.pathname.match(/\/tournaments\/([^/]+)/)?.[1];
        if (tournamentId) {
          navigate(`/tournaments/${tournamentId}/director`);
        }
      },
      keywords: ['control', 'monitor', 'operations'],
      requiresAuth: true,
      requiresRole: ['admin', 'director'],
    },
    {
      id: 'schedule',
      label: 'Schedule',
      description: 'View schedule (requires active tournament)',
      icon: Calendar,
      action: () => {
        const tournamentId = location.pathname.match(/\/tournaments\/([^/]+)/)?.[1];
        if (tournamentId) {
          navigate(`/tournaments/${tournamentId}/schedule`);
        }
      },
      keywords: ['timing', 'rings', 'timeline'],
      requiresAuth: true,
    },
    {
      id: 'results',
      label: 'Results',
      description: 'View results (requires active tournament)',
      icon: FileText,
      action: () => {
        const tournamentId = location.pathname.match(/\/tournaments\/([^/]+)/)?.[1];
        if (tournamentId) {
          navigate(`/tournaments/${tournamentId}/results`);
        }
      },
      keywords: ['placements', 'winners', 'export'],
      requiresAuth: true,
    },
    {
      id: 'settings',
      label: 'Tournament Settings',
      description: 'Configure tournament (requires active tournament)',
      icon: Settings,
      action: () => {
        const tournamentId = location.pathname.match(/\/tournaments\/([^/]+)/)?.[1];
        if (tournamentId) {
          navigate(`/tournaments/${tournamentId}/settings`);
        }
      },
      keywords: ['config', 'rules', 'weight classes'],
      requiresAuth: true,
      requiresRole: ['admin', 'director'],
    },
    {
      id: 'trash',
      label: 'Trash',
      description: 'View deleted tournaments',
      icon: Trash2,
      action: () => navigate('/tournaments?trash=true'),
      keywords: ['deleted', 'archive'],
      requiresAuth: true,
      requiresRole: ['admin', 'director'],
    },
    {
      id: 'help',
      label: 'Help',
      description: 'View help center',
      icon: HelpCircle,
      action: () => navigate('/help'),
      keywords: ['support', 'documentation', 'guide'],
    },
  ], [navigate, location]);

  const filteredCommands = useMemo(() => {
    const lowerQuery = query.toLowerCase();
    
    return commands.filter(cmd => {
      if (cmd.requiresAuth && !isAuthenticated) return false;
      if (cmd.requiresRole && !hasRole(cmd.requiresRole)) return false;
      
      if (!lowerQuery) return true;
      
      const searchableText = [
        cmd.label,
        cmd.description || '',
        ...(cmd.keywords || []),
      ].join(' ').toLowerCase();
      
      return searchableText.includes(lowerQuery);
    });
  }, [query, commands, isAuthenticated, hasRole]);

  const handleSelect = useCallback((command: CommandItem) => {
    command.action();
    onClose();
    setQuery('');
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, filteredCommands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        handleSelect(filteredCommands[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [selectedIndex, filteredCommands, handleSelect, onClose]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 animate-fadeIn"
        onClick={onClose}
      />
      <div className="fixed top-[20vh] left-1/2 -translate-x-1/2 w-full max-w-2xl z-50 animate-slideDown">
        <div
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={true}
          aria-owns="cmdk-list"
        >
          <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-700">
            <Search className="w-5 h-5 text-gray-400" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              aria-autocomplete="list"
              aria-controls="cmdk-list"
              aria-activedescendant={
                filteredCommands.length > 0 && selectedIndex >= 0
                  ? `cmdk-row-${selectedIndex}`
                  : undefined
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search commands..."
              aria-label="Command palette search"
              className="flex-1 bg-transparent border-none outline-none text-base text-gray-900 dark:text-gray-100 placeholder-gray-400"
            />
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <kbd className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
                ESC
              </kbd>
              <span>to close</span>
            </div>
          </div>
          
          <div className="max-h-[60vh] overflow-y-auto">
            {filteredCommands.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <Search className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" aria-hidden="true" />
                <p className="text-gray-500 dark:text-gray-400" role="status">No commands found</p>
              </div>
            ) : (
              <div
                id="cmdk-list"
                role="listbox"
                aria-label="Command results"
                className="py-2"
              >
                {filteredCommands.map((command, index) => {
                  const Icon = command.icon;
                  const isSelected = index === selectedIndex;
                  const rowId = `cmdk-row-${index}`;

                  return (
                    <button
                      key={command.id}
                      id={rowId}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelect(command)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`
                        w-full px-5 py-3 flex items-center gap-3 text-left transition-colors
                        ${isSelected
                          ? 'bg-red-50 dark:bg-red-900/20 border-l-2 border-red-600'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                        }
                      `}
                    >
                      <Icon className={`w-5 h-5 ${isSelected ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`} />
                      <div className="flex-1 min-w-0">
                        <div className={`font-medium ${isSelected ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
                          {command.label}
                        </div>
                        {command.description && (
                          <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                            {command.description}
                          </div>
                        )}
                      </div>
                      <ChevronRight className={`w-4 h-4 ${isSelected ? 'text-red-600 dark:text-red-400' : 'text-gray-300'}`} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          
          <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-white dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
                    ↑
                  </kbd>
                  <kbd className="px-1.5 py-0.5 bg-white dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
                    ↓
                  </kbd>
                  <span>navigate</span>
                </div>
                <div className="flex items-center gap-1">
                  <kbd className="px-2 py-0.5 bg-white dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
                    ↵
                  </kbd>
                  <span>select</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Command className="w-3 h-3" />
                <span>K to open</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen(prev => !prev),
  };
}
