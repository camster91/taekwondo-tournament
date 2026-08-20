import { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Settings } from 'lucide-react';
import ConfirmDialog from './ui/ConfirmDialog';

interface MatchTimerProps {
  defaultRoundTime?: number; // seconds
  defaultRounds?: number;
  defaultBreakTime?: number; // seconds between rounds
  onRoundEnd?: (round: number) => void;
  onMatchEnd?: () => void;
}

export default function MatchTimer({
  defaultRoundTime = 120, // 2 minutes
  defaultRounds = 2,
  defaultBreakTime = 30,
  onRoundEnd,
  onMatchEnd,
}: MatchTimerProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(defaultRoundTime);
  const [currentRound, setCurrentRound] = useState(1);
  const [isBreak, setIsBreak] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Configurable settings
  const [roundTime, setRoundTime] = useState(defaultRoundTime);
  const [totalRounds, setTotalRounds] = useState(defaultRounds);
  const [breakTime, setBreakTime] = useState(defaultBreakTime);

  const audioContextRef = useRef<AudioContext | null>(null);
  // Wall-clock baseline for the running timer. Computed once when the
  // user starts a round/break, and re-computed on every tick. This
  // means browser tab throttling (backgrounded, screen dim) does NOT
  // drift the displayed countdown — the math is "when does this end"
  // not "count down a state variable".
  const endAtRef = useRef<number | null>(null);
  // Beep / end-sound setTimeout ids, cleared on unmount so a 600ms
  // queued beep doesn't fire after the user navigates away.
  const pendingTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Play beep sound
  const playBeep = useCallback((frequency: number = 800, duration: number = 200) => {
    if (!soundEnabled) return;

    try {
      if (!audioContextRef.current) {
        // `webkitAudioContext` is a Safari-prefixed fallback. Declare
        // it locally as `AudioContext | undefined` rather than casting
        // `window` to `any` — the cast never leaves the assignment.
        const Ctor =
          (window as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
          (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctor) {
          audioContextRef.current = new Ctor();
        }
      }

      const ctx = audioContextRef.current;
      // No-op when the browser doesn't expose AudioContext (rare —
      // mostly older Safari with the prefix removed). The previous
      // `any` swallow hid a runtime TypeError in that case.
      if (!ctx) return;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration / 1000);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + duration / 1000);
    } catch (e) {
      console.error('Audio playback failed:', e);
    }
  }, [soundEnabled]);

  // Play warning beeps (10 seconds left)
  const playWarning = useCallback(() => {
    playBeep(600, 150);
  }, [playBeep]);

  // Play end of round sound
  const playEndSound = useCallback(() => {
    playBeep(1000, 500);
    const id = setTimeout(() => playBeep(1000, 500), 600);
    pendingTimeoutsRef.current.add(id);
  }, [playBeep]);

  // Clear any queued beeps on unmount.
  useEffect(() => {
    const set = pendingTimeoutsRef.current;
    return () => {
      for (const id of set) clearTimeout(id);
      set.clear();
    };
  }, []);

  // Timer logic. Use a Date.now() baseline (`endAtRef`) so a throttled
  // background tab does not cause the countdown to drift. The display
  // re-derives from wall-clock every 250ms; React state only updates
  // when the rounded second changes.
  useEffect(() => {
    if (!isRunning) {
      endAtRef.current = null;
      return;
    }
    if (endAtRef.current == null) {
      // Just started — baseline now + remaining timeLeft.
      const remaining = timeLeft > 0 ? timeLeft : (isBreak ? breakTime : roundTime);
      endAtRef.current = Date.now() + remaining * 1000;
    }
    let lastDisplayedSecond = timeLeft;

    const tick = () => {
      if (endAtRef.current == null) return;
      const msLeft = Math.max(0, endAtRef.current - Date.now());
      const secondsLeft = Math.ceil(msLeft / 1000);
      if (secondsLeft !== lastDisplayedSecond) {
        lastDisplayedSecond = secondsLeft;
        setTimeLeft(secondsLeft);
        if (!isBreak && [10, 5, 4, 3, 2, 1].includes(secondsLeft)) {
          playWarning();
        }
      }
      if (msLeft <= 0) {
        setIsRunning(false);
        endAtRef.current = null;
        playEndSound();
        if (isBreak) {
          setIsBreak(false);
          setTimeLeft(roundTime);
          setCurrentRound((prev) => prev + 1);
        } else if (currentRound < totalRounds) {
          onRoundEnd?.(currentRound);
          setIsBreak(true);
          setTimeLeft(breakTime);
        } else {
          onRoundEnd?.(currentRound);
          onMatchEnd?.();
        }
      }
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
    // intentionally not depending on timeLeft (we read it for the
    // initial baseline only). Other deps must be listed so the effect
    // re-runs when the round/break settings change mid-flight.
  }, [isRunning, currentRound, totalRounds, isBreak, roundTime, breakTime, playWarning, playEndSound, onRoundEnd, onMatchEnd]);

  const toggleTimer = useCallback(() => {
    setIsRunning(prev => !prev);
  }, []);

  // Space bar shortcut to start/pause timer
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'SELECT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        toggleTimer();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleTimer]);

  const handleConfirmReset = () => {
    setShowResetConfirm(false);
    setIsRunning(false);
    endAtRef.current = null;
    setTimeLeft(roundTime);
    setCurrentRound(1);
    setIsBreak(false);
  };

  const resetRound = () => {
    setIsRunning(false);
    endAtRef.current = null;
    setTimeLeft(isBreak ? breakTime : roundTime);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getTimerColor = () => {
    if (isBreak) return 'text-blue-400';
    if (timeLeft <= 10) return 'text-red-500 animate-pulse';
    if (timeLeft <= 30) return 'text-yellow-500';
    return 'text-green-400';
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      {/* Timer Display */}
      <div className="text-center mb-4">
        <div className="text-sm text-gray-400 mb-1">
          {isBreak ? 'BREAK' : `ROUND ${currentRound} of ${totalRounds}`}
        </div>
        <div className={`text-6xl font-mono font-bold ${getTimerColor()}`}>
          {formatTime(timeLeft)}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3 mb-3">
        <button
          onClick={toggleTimer}
          className={`p-3 rounded-full ${
            isRunning ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-green-600 hover:bg-green-700'
          } transition-colors`}
          title={isRunning ? 'Pause (Space)' : 'Start (Space)'}
        >
          {isRunning ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
        </button>

        <button
          onClick={resetRound}
          className="p-3 rounded-full bg-gray-600 hover:bg-gray-700 transition-colors"
          title="Reset Round"
        >
          <RotateCcw className="h-6 w-6" />
        </button>

        <button
          onClick={() => setShowResetConfirm(true)}
          className="p-2 rounded-lg bg-red-600 hover:bg-red-700 transition-colors text-sm px-3"
          title="Reset Match"
        >
          Reset All
        </button>

        <button
          onClick={() => setSoundEnabled(!soundEnabled)}
          className={`p-2 rounded-lg ${soundEnabled ? 'bg-gray-600' : 'bg-gray-700'} hover:bg-gray-500 transition-colors`}
          title={soundEnabled ? 'Mute' : 'Unmute'}
        >
          {soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
        </button>

        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-2 rounded-lg bg-gray-600 hover:bg-gray-500 transition-colors"
          title="Settings"
        >
          <Settings className="h-5 w-5" />
        </button>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-gray-700 rounded-lg p-3 mt-3 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Round Time</label>
              <select
                value={roundTime}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setRoundTime(val);
                  if (!isRunning && !isBreak) setTimeLeft(val);
                }}
                className="w-full bg-gray-800 rounded px-2 py-1 text-sm"
              >
                <option value={60}>1:00</option>
                <option value={90}>1:30</option>
                <option value={120}>2:00</option>
                <option value={150}>2:30</option>
                <option value={180}>3:00</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Rounds</label>
              <select
                value={totalRounds}
                onChange={(e) => setTotalRounds(Number(e.target.value))}
                className="w-full bg-gray-800 rounded px-2 py-1 text-sm"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Break Time</label>
              <select
                value={breakTime}
                onChange={(e) => setBreakTime(Number(e.target.value))}
                className="w-full bg-gray-800 rounded px-2 py-1 text-sm"
              >
                <option value={15}>0:15</option>
                <option value={30}>0:30</option>
                <option value={45}>0:45</option>
                <option value={60}>1:00</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard shortcut hint */}
      <div className="text-center text-xs text-gray-500 mt-2">
        Press <kbd className="px-1 bg-gray-700 rounded">Space</kbd> to start/pause
      </div>

      {/* Reset Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={handleConfirmReset}
        title="Reset Match Timer"
        message="Reset the entire match timer? This wipes round count, time-left, and break state. There is no undo on tournament day."
        confirmText="Reset Timer"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
}
