import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lock, Unlock, Shield } from 'lucide-react';
import EncryptPage from './components/EncryptPage';
import DecryptPage from './components/DecryptPage';

export default function App() {
  const [view, setView] = useState<'home' | 'encrypt' | 'decrypt'>('home');
  const [payloadId, setPayloadId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id) {
      setPayloadId(id);
      setView('decrypt');
    }
  }, []);

  return (
    <div className="min-h-screen transition-colors duration-300 dark bg-zinc-950 text-zinc-50">
      <header className="flex flex-col items-center justify-center p-8 max-w-5xl mx-auto gap-2">
        <button onClick={() => setView('home')} className="flex items-center gap-3 text-2xl md:text-3xl font-bold tracking-tight hover:opacity-80 transition-opacity">
          <Shield className="w-8 h-8 text-indigo-500" />
          CipherDrop
        </button>
        <span className="text-xs md:text-sm font-medium text-zinc-500 bg-zinc-100 dark:bg-zinc-800/80 px-3 py-1 rounded-full">
          Made by Vilas K R
        </span>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {view === 'home' && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center justify-center min-h-[60vh] text-center"
            >
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
                End-to-End Encryption, <br className="hidden md:block" />
                Simplified.
              </h1>
              <p className="text-zinc-500 dark:text-zinc-400 max-w-xl mx-auto mb-12 text-lg">
                Securely encrypt and decrypt messages, images, and audio. Zero-knowledge. Client-side only. No data ever leaves your device unencrypted.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-2xl">
                <button
                  onClick={() => setView('encrypt')}
                  className="group relative flex flex-col items-center justify-center p-8 bg-white dark:bg-zinc-900 rounded-3xl shadow-sm hover:shadow-md border border-zinc-200 dark:border-zinc-800 transition-all"
                >
                  <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-500/10 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <Lock className="w-8 h-8 text-indigo-500" />
                  </div>
                  <h2 className="text-xl font-semibold mb-2">Encrypt</h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Secure your data with a key</p>
                </button>

                <button
                  onClick={() => setView('decrypt')}
                  className="group relative flex flex-col items-center justify-center p-8 bg-white dark:bg-zinc-900 rounded-3xl shadow-sm hover:shadow-md border border-zinc-200 dark:border-zinc-800 transition-all"
                >
                  <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-500/10 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <Unlock className="w-8 h-8 text-emerald-500" />
                  </div>
                  <h2 className="text-xl font-semibold mb-2">Decrypt</h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Unlock data with your key</p>
                </button>
              </div>
            </motion.div>
          )}

          {view === 'encrypt' && (
            <motion.div
              key="encrypt"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <EncryptPage onBack={() => setView('home')} />
            </motion.div>
          )}

          {view === 'decrypt' && (
            <motion.div
              key="decrypt"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <DecryptPage 
                onBack={() => {
                  setView('home');
                  if (payloadId) {
                    window.history.replaceState({}, document.title, window.location.pathname);
                    setPayloadId(null);
                  }
                }} 
                initialPayloadId={payloadId}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="py-6 text-center text-zinc-500 text-sm">
        <p>&copy; {new Date().getFullYear()} Vilas K R. All rights reserved.</p>
      </footer>
    </div>
  );
}
