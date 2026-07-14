import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, Send, Volume2, VolumeX } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const API_URL = 'https://uday-bot-backend.vercel.app';

function App() {
  // Retrieve or generate persistent sessionId
  const [sessionId] = useState(() => {
    let id = localStorage.getItem('uday_session_id');
    if (!id) {
      id = 'session-' + Math.random().toString(36).substring(2, 11);
      localStorage.setItem('uday_session_id', id);
    }
    return id;
  });

  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      text: "Hey artist, what's up buddy?",
      audioUrl: null
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');

  // Audio and sound settings
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [playingMessageId, setPlayingMessageId] = useState(null);
  const [activeAudioUrl, setActiveAudioUrl] = useState(null);

  const chatEndRef = useRef(null);
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);

  const maxCharCount = 150;

  // Auto-scroll chat window when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Load chat history from database on startup
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const response = await fetch(`${API_URL}/api/chat/history?sessionId=${sessionId}`);
        if (response.ok) {
          const data = await response.json();
          if (data && data.history && data.history.length > 0) {
            const mapped = data.history.map(m => ({
              id: m._id,
              role: m.role,
              text: m.content,
              audioUrl: null
            }));
            setMessages(mapped);
          }
        }
      } catch (err) {
        console.warn("Failed to load chat history:", err);
      }
    };
    fetchHistory();
  }, [sessionId]);

  const getAudioContext = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) audioContextRef.current = new AudioCtx();
    }
    return audioContextRef.current;
  }, []);

  const playChime = useCallback((notes, volume = 0.05) => {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      notes.forEach(({ freq, at }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = ctx.currentTime + at;
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.2);
      });
    } catch (e) {
      console.warn("AudioContext chime failure:", e);
    }
  }, [soundEnabled, getAudioContext]);

  const playSend = useCallback(() => {
    playChime([
      { freq: 523.25, at: 0 },
      { freq: 783.99, at: 0.06 },
    ], 0.04);
  }, [playChime]);

  const playReceive = useCallback(() => {
    playChime([
      { freq: 392.0, at: 0 },
      { freq: 587.33, at: 0.08 },
    ], 0.04);
  }, [playChime]);

  // Close AudioContext on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(err => console.warn(err));
      }
    };
  }, []);

  // Audio event listeners for voice cloning outputs
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPause = () => setPlayingMessageId(null);
    const onEnded = () => setPlayingMessageId(null);

    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, [activeAudioUrl]);

  // Play audio for a specific message
  const playAudio = (messageId, url) => {
    if (!url) return;

    if (playingMessageId === messageId) {
      audioRef.current.pause();
      setPlayingMessageId(null);
    } else {
      setPlayingMessageId(messageId);
      setActiveAudioUrl(url);
      
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.load();
          audioRef.current.play().catch(e => {
            console.error("Playback failed:", e);
            setPlayingMessageId(null);
          });
        }
      }, 50);
    }
  };

  const handleInputChange = (e) => {
    if (e.target.value.length <= maxCharCount) {
      setInputText(e.target.value);
    }
  };

  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    const queryText = inputText.trim();
    if (!queryText || loading) return;

    // Play send audio chime
    playSend();

    // 1. Add user message
    const userMsgId = 'user-' + Date.now();
    const userMsg = {
      id: userMsgId,
      role: 'user',
      text: queryText
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setLoading(true);
    setError('');
    setStatusText('Thinking...');

    // In-flight status prompts
    const statusMessages = [
      'Formulating response...',
      'Synthesizing voice via Cartesia AI...',
      'Optimizing response streams...',
      'Delivering cloned voice...'
    ];
    let msgIdx = 0;
    const interval = setInterval(() => {
      if (msgIdx < statusMessages.length - 1) {
        msgIdx++;
        setStatusText(statusMessages[msgIdx]);
      }
    }, 2000);

    // Build conversation payload for context (up to last 10 messages)
    const contextMessages = messages
      .concat(userMsg)
      .slice(-10)
      .map(m => ({
        role: m.role,
        content: m.text
      }));

    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          messages: contextMessages,
          sessionId: sessionId
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.details || data.error || 'Server failed to process query.');
      }

      // Play receive audio chime
      playReceive();

      // 2. Add assistant message with returned audio URL
      const botMsgId = 'bot-' + Date.now();
      const botMsg = {
        id: botMsgId,
        role: 'assistant',
        text: data.reply || data.text,
        audioUrl: data.audioUrl
      };

      setMessages(prev => [...prev, botMsg]);

      // 3. Auto-play the response voice
      if (data.audioUrl) {
        playAudio(botMsgId, data.audioUrl);
      }

    } catch (err) {
      console.error(err);
      setError(err.message || 'Something went wrong.');
    } finally {
      clearInterval(interval);
      setLoading(false);
    }
  };

  const handleInputFocus = () => {
    setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 300);
  };

  const hasText = inputText.trim().length > 0;

  return (
    <div className="fixed inset-0 flex flex-col justify-between bg-[#0b0f19] text-[#f3f4f6] px-4 md:px-8 h-[100dvh] w-screen overflow-hidden">
      {/* Background Glowing Accents */}
      <div className="bg-glow bg-glow-1"></div>
      <div className="bg-glow bg-glow-2"></div>

      {/* Hidden global audio element */}
      <audio ref={audioRef} src={activeAudioUrl} />

      {/* Header bar */}
      <header className="z-10 flex items-center justify-between w-full max-w-4xl mx-auto h-20 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl overflow-hidden border border-white/10 bg-white/5">
            <img 
              src="/uday_dp.jpeg" 
              alt="Uday Bot Profile" 
              className="w-full h-full object-cover" 
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.parentNode.innerHTML = '🤖';
              }}
            />
          </div>
          <div>
            <h1 className="text-lg font-extrabold uppercase tracking-tight" style={{ fontFamily: "'League Spartan', sans-serif" }}>
              <span className="text-[#f3f4f6]">uday (</span>
              <span className="text-red-500">ART</span>
              <span className="text-[#f3f4f6]">ARTIST)</span>
            </h1>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-[11px] font-semibold text-emerald-500 tracking-wide uppercase">Online</span>
            </div>
          </div>
        </div>
        
        {/* Controls: Sound Mute */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="flex items-center justify-center w-10 h-10 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all text-[#9ca3af] hover:text-[#f3f4f6]"
            title={soundEnabled ? "Mute sounds" : "Unmute sounds"}
          >
            {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Main chat viewport */}
      <main className="flex-grow overflow-y-auto overflow-x-hidden w-full max-w-2xl mx-auto py-4 scrollbar-none">
        <div className="space-y-4 pr-1 pb-4">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 15, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: "spring", stiffness: 350, damping: 28 }}
                className={`flex gap-3.5 w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {/* Bot Avatar image */}
                {msg.role === 'assistant' && (
                  <div className="flex-shrink-0 w-9 h-9 rounded-lg overflow-hidden border border-white/10 bg-white/5 shadow-md">
                    <img 
                      src="/uday_dp.jpeg" 
                      alt="Uday Bot" 
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.parentNode.innerHTML = '🤖';
                      }}
                    />
                  </div>
                )}

                {/* Message Bubble */}
                <div 
                  className={`relative max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-md border transition-all ${
                    msg.role === 'user'
                      ? 'bg-white/5 border-white/10 text-[#f3f4f6] rounded-tr-none'
                      : 'bg-primary border-primary/20 text-white rounded-tl-none hover:bg-primary/95 cursor-pointer active:scale-[0.99]'
                  }`}
                  onClick={() => {
                    if (msg.role === 'assistant' && msg.audioUrl) {
                      playAudio(msg.id, msg.audioUrl);
                    }
                  }}
                  title={msg.role === 'assistant' && msg.audioUrl ? "Tap to speak out" : undefined}
                >
                  <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  
                  {/* Small visualizer inside bubble when speaking */}
                  {msg.audioUrl && playingMessageId === msg.id && (
                    <div className="mt-2 pt-2 border-t border-white/10 flex items-center gap-2 select-none">
                      <span className="text-[10px] text-white/60 font-semibold uppercase tracking-wider">Speaking</span>
                      <div className="bubble-mini-visualizer">
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}

            {/* Thinking / Loading indicator */}
            {loading && (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-3.5 w-full justify-start"
              >
                <div className="flex-shrink-0 w-9 h-9 rounded-lg overflow-hidden border border-white/10 bg-white/5 shadow-md">
                  <img 
                    src="/uday_dp.jpeg" 
                    alt="Uday Bot" 
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.parentNode.innerHTML = '🤖';
                    }}
                  />
                </div>
                <div className="max-w-[80%] rounded-2xl rounded-tl-none px-4 py-3 text-sm bg-primary border border-primary/20 text-white shadow-md flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                  </div>
                  <span className="text-[11px] text-white/70 font-medium tracking-wide">{statusText}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error message */}
          {error && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex justify-center w-full"
            >
              <div className="px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold shadow-md flex items-center gap-2">
                <span>⚠️</span> Connection Error: {error}
              </div>
            </motion.div>
          )}

          <div ref={chatEndRef} />
        </div>
      </main>

      {/* Input panel footer */}
      <footer className="z-10 w-full max-w-xl mx-auto pb-6 pt-2">
        <form onSubmit={handleSendMessage} className="relative rounded-3xl border border-white/10 bg-white/5 p-1 shadow-lg backdrop-blur-md">
          <div className="relative flex items-center justify-between gap-2 rounded-3xl bg-slate-900/40 p-1.5">
            <div className="flex flex-1 items-center gap-3 pr-1">
              <button
                type="button"
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 active:scale-95 transition-all text-[#9ca3af] hover:text-[#f3f4f6]"
                aria-label="Add attachment"
              >
                <Plus className="w-5 h-5" />
              </button>
              <input
                type="text"
                value={inputText}
                onChange={handleInputChange}
                onFocus={handleInputFocus}
                disabled={loading}
                placeholder="Send Message"
                aria-label="Message"
                className="h-auto flex-1 border-0 bg-transparent px-0 py-0 text-base shadow-none outline-none focus:ring-0 text-[#f3f4f6] placeholder-white/30 md:text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !inputText.trim()}
              className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all active:scale-95 ${
                hasText 
                  ? 'bg-primary text-white hover:bg-primary/95 shadow-md shadow-primary/20' 
                  : 'bg-white/5 text-white/30 cursor-not-allowed border border-white/5'
              }`}
              aria-label="Send message"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
          
          <div className="absolute right-6 -bottom-5 text-[10px] text-white/30">
            {inputText.length}/{maxCharCount} characters
          </div>
        </form>
      </footer>
    </div>
  );
}

export default App;
