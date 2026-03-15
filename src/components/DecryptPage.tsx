import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Unlock, Key, FileText, Image as ImageIcon, Music, AlertCircle, RefreshCw, Download, Copy, CheckCircle2 } from 'lucide-react';
import { decryptData, DataType, bytesToBase64 } from '../lib/crypto';
import { cn } from '../lib/utils';
import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

export default function DecryptPage({ onBack, initialPayloadId }: { onBack: () => void, initialPayloadId?: string | null }) {
  const [encryptedInput, setEncryptedInput] = useState('');
  const [decryptionKey, setDecryptionKey] = useState('');
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [isLoadingPayload, setIsLoadingPayload] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ data: Uint8Array; dataType: DataType; fileName?: string; fileType?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (result && (result.dataType === 'image' || result.dataType === 'audio')) {
      const blob = new Blob([result.data], { type: result.fileType || (result.dataType === 'image' ? 'image/png' : 'audio/mp3') });
      try {
        const url = URL.createObjectURL(blob);
        setMediaUrl(url);
        return () => URL.revokeObjectURL(url);
      } catch (e) {
        const reader = new FileReader();
        reader.onload = () => setMediaUrl(reader.result as string);
        reader.readAsDataURL(blob);
      }
    } else {
      setMediaUrl(null);
    }
  }, [result]);

  useEffect(() => {
    if (initialPayloadId) {
      const fetchPayload = async () => {
        setIsLoadingPayload(true);
        try {
          const docRef = doc(db, 'payloads', initialPayloadId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            setEncryptedInput(docSnap.data().encryptedData);
          } else {
            setError('Shared payload not found or has been deleted.');
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `payloads/${initialPayloadId}`);
          setError('Failed to load shared payload.');
        } finally {
          setIsLoadingPayload(false);
        }
      };
      fetchPayload();
    }
  }, [initialPayloadId]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await processFile(e.target.files[0]);
    }
  };

  const processFile = async (file: File) => {
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
      });
      setEncryptedInput(text);
      setError('');
    } catch (err) {
      setError('Failed to read file');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await processFile(e.dataTransfer.files[0]);
    }
  };

  const handleDecrypt = async () => {
    if (!encryptedInput.trim()) {
      setError('Please paste the encrypted data or upload a file');
      return;
    }
    if (!decryptionKey) {
      setError('Please enter the decryption key');
      return;
    }

    setIsDecrypting(true);
    setError('');
    setResult(null);

    try {
      const decrypted = await decryptData(encryptedInput.trim(), decryptionKey);
      setResult(decrypted);
    } catch (err: any) {
      setError(err.message || 'Decryption failed. Wrong key or corrupted data.');
    } finally {
      setIsDecrypting(false);
    }
  };

  const handleCopyText = async () => {
    if (result?.dataType === 'text') {
      try {
        const text = new TextDecoder().decode(result.data);
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const textArea = document.createElement("textarea");
          textArea.value = text;
          textArea.style.position = "fixed";
          textArea.style.left = "-999999px";
          textArea.style.top = "-999999px";
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          document.execCommand('copy');
          textArea.remove();
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        setError('Failed to copy text');
      }
    }
  };

  const handleDownloadFile = () => {
    if (!result) return;
    
    const blob = new Blob([result.data], { type: result.fileType || 'application/octet-stream' });
    const filename = result.fileName || `decrypted-${Date.now()}`;
    
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      const reader = new FileReader();
      reader.onload = () => {
        const a = document.createElement('a');
        a.href = reader.result as string;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };
      reader.readAsDataURL(blob);
    }
  };

  const renderResult = () => {
    if (!result) return null;

    if (result.dataType === 'text') {
      const text = new TextDecoder().decode(result.data);
      return (
        <div className="relative">
          <textarea
            readOnly
            value={text}
            className="w-full h-40 p-4 pr-12 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm font-mono text-zinc-800 dark:text-zinc-200 resize-none outline-none"
          />
          <button
            onClick={handleCopyText}
            className="absolute top-4 right-4 p-2 bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
            title="Copy to clipboard"
          >
            {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      );
    }

    if (result.dataType === 'image') {
      return (
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-full max-w-md rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
            {mediaUrl && <img src={mediaUrl} alt="Decrypted" className="w-full h-auto object-contain" />}
          </div>
          <button
            onClick={handleDownloadFile}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            Download Image
          </button>
        </div>
      );
    }

    if (result.dataType === 'audio') {
      return (
        <div className="flex flex-col items-center gap-6 p-6 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800">
          <Music className="w-12 h-12 text-indigo-500 mb-2" />
          {mediaUrl && <audio controls src={mediaUrl} className="w-full max-w-md" />}
          <button
            onClick={handleDownloadFile}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            Download Audio
          </button>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 mb-8 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to Home
      </button>

      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-10 shadow-sm border border-zinc-200 dark:border-zinc-800">
        <h2 className="text-2xl font-semibold mb-8">Decrypt Data</h2>

        {/* Input Area */}
        <div className="mb-8">
          <label className="block text-sm font-medium mb-2">Encrypted Payload</label>
          <div 
            className={cn(
              "relative rounded-2xl transition-colors border-2",
              isDragging ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10" : "border-transparent"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isLoadingPayload && (
              <div className="absolute inset-0 z-10 bg-white/50 dark:bg-zinc-900/50 flex items-center justify-center rounded-2xl backdrop-blur-sm">
                <RefreshCw className="w-6 h-6 animate-spin text-emerald-500" />
              </div>
            )}
            <textarea
              value={encryptedInput}
              onChange={(e) => setEncryptedInput(e.target.value)}
              placeholder="Paste the encrypted string here, or drag and drop a .txt file..."
              className="w-full h-40 p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none resize-none transition-all font-mono text-sm"
            />
            <div className="absolute bottom-4 right-4 flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors shadow-sm"
              >
                Upload File
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".txt"
                className="hidden"
              />
            </div>
          </div>
        </div>

        {/* Key Input */}
        <div className="mb-8">
          <label className="block text-sm font-medium mb-2">Decryption Key</label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Key className="w-4 h-4 text-zinc-400" />
            </div>
            <input
              type="text"
              value={decryptionKey}
              onChange={(e) => setDecryptionKey(e.target.value)}
              placeholder="Enter the secret key..."
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-xl flex items-center gap-3 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            {error}
          </div>
        )}

        <button
          onClick={handleDecrypt}
          disabled={isDecrypting || !encryptedInput || !decryptionKey}
          className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium text-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isDecrypting ? (
            <RefreshCw className="w-5 h-5 animate-spin" />
          ) : (
            <Unlock className="w-5 h-5" />
          )}
          {isDecrypting ? 'Decrypting...' : 'Decrypt Data'}
        </button>

        {/* Result Area */}
        {result && (
          <div className="mt-10 pt-10 border-t border-zinc-200 dark:border-zinc-800 animate-in fade-in slide-in-from-bottom-4">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
                {result.dataType === 'text' && <FileText className="w-5 h-5 text-emerald-500" />}
                {result.dataType === 'image' && <ImageIcon className="w-5 h-5 text-emerald-500" />}
                {result.dataType === 'audio' && <Music className="w-5 h-5 text-emerald-500" />}
              </div>
              <div>
                <h3 className="text-lg font-medium">Decrypted Successfully</h3>
                <p className="text-sm text-zinc-500 capitalize">{result.dataType} Content</p>
              </div>
            </div>
            
            {renderResult()}
          </div>
        )}
      </div>
    </div>
  );
}
