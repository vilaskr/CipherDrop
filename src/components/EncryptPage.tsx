import React, { useState, useRef } from 'react';
import { ArrowLeft, FileText, Image as ImageIcon, Music, Key, Copy, Download, RefreshCw, CheckCircle2, AlertCircle, Lock, Share2, Link } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { encryptData, generateSecureKey, calculateKeyStrength, DataType } from '../lib/crypto';
import { cn } from '../lib/utils';
import { useAuth } from '../lib/useAuth';
import { db, auth } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

export default function EncryptPage({ onBack }: { onBack: () => void }) {
  const [dataType, setDataType] = useState<DataType>('text');
  const [textInput, setTextInput] = useState('');
  const [fileInput, setFileInput] = useState<File | null>(null);
  const [encryptionKey, setEncryptionKey] = useState('');
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [encryptedResult, setEncryptedResult] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [autoClear, setAutoClear] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  const { user, signIn } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const keyStrength = calculateKeyStrength(encryptionKey);

  const handleGenerateKey = () => {
    setEncryptionKey(generateSecureKey());
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 10 * 1024 * 1024) {
        setError('File size must be less than 10MB');
        return;
      }
      setFileInput(file);
      setError('');
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.size > 10 * 1024 * 1024) {
        setError('File size must be less than 10MB');
        return;
      }
      setFileInput(file);
      setError('');
    }
  };

  const handleEncrypt = async () => {
    if (!encryptionKey) {
      setError('Please enter or generate an encryption key');
      return;
    }

    setIsEncrypting(true);
    setError('');
    setEncryptedResult('');

    try {
      let dataToEncrypt: Uint8Array;
      let fileName: string | undefined;
      let fileType: string | undefined;

      if (dataType === 'text') {
        if (!textInput.trim()) throw new Error('Please enter some text to encrypt');
        dataToEncrypt = new TextEncoder().encode(textInput);
      } else {
        if (!fileInput) throw new Error('Please select a file to encrypt');
        
        const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsArrayBuffer(fileInput);
        });
        
        dataToEncrypt = new Uint8Array(arrayBuffer);
        fileName = fileInput.name;
        fileType = fileInput.type;
      }

      const result = await encryptData(dataToEncrypt, encryptionKey, dataType, fileName, fileType);
      setEncryptedResult(result);
    } catch (err: any) {
      setError(err.message || 'Encryption failed');
    } finally {
      setIsEncrypting(false);
    }
  };

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(encryptedResult);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = encryptedResult;
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

      if (autoClear) {
        setTimeout(async () => {
          try {
            if (navigator.clipboard && window.isSecureContext) {
              await navigator.clipboard.writeText('');
            }
          } catch (e) {
            // Ignore clear errors
          }
        }, 60000);
      }
    } catch (err) {
      setError('Failed to copy to clipboard');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([encryptedResult], { type: 'text/plain;charset=utf-8' });
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cipherdrop-${Date.now()}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      const reader = new FileReader();
      reader.onload = () => {
        const a = document.createElement('a');
        a.href = reader.result as string;
        a.download = `cipherdrop-${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };
      reader.readAsDataURL(blob);
    }
  };

  const handleShare = async () => {
    if (!user) {
      try {
        await signIn();
      } catch (err: any) {
        if (err.code === 'auth/unauthorized-domain') {
          setError('This domain is not authorized for Firebase Authentication. Please add it to the Authorized Domains list in the Firebase Console.');
        } else {
          setError('Failed to sign in: ' + err.message);
        }
        return;
      }
      if (!auth.currentUser) return; // User cancelled sign in
    }

    setIsSharing(true);
    setError('');

    try {
      const docRef = await addDoc(collection(db, 'payloads'), {
        encryptedData: encryptedResult,
        authorUID: auth.currentUser!.uid,
        createdAt: serverTimestamp()
      });
      
      const link = `${window.location.origin}/?id=${docRef.id}`;
      setShareLink(link);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'payloads');
      setError('Failed to create share link');
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(shareLink);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = shareLink;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      setError('Failed to copy link');
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 mb-8 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to Home
      </button>

      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-10 shadow-sm border border-zinc-200 dark:border-zinc-800">
        <h2 className="text-2xl font-semibold mb-8">Encrypt Data</h2>

        {/* Data Type Selector */}
        <div className="flex gap-4 mb-8">
          {[
            { id: 'text', icon: FileText, label: 'Text' },
            { id: 'image', icon: ImageIcon, label: 'Image' },
            { id: 'audio', icon: Music, label: 'Audio' },
          ].map((type) => (
            <button
              key={type.id}
              onClick={() => {
                setDataType(type.id as DataType);
                setFileInput(null);
                setTextInput('');
                setError('');
              }}
              className={cn(
                "flex-1 flex flex-col items-center justify-center py-4 rounded-2xl border-2 transition-all",
                dataType === type.id
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                  : "border-zinc-100 dark:border-zinc-800 hover:border-zinc-200 dark:hover:border-zinc-700 text-zinc-500"
              )}
            >
              <type.icon className="w-6 h-6 mb-2" />
              <span className="text-sm font-medium">{type.label}</span>
            </button>
          ))}
        </div>

        {/* Input Area */}
        <div className="mb-8">
          {dataType === 'text' ? (
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Enter your secret message here..."
              className="w-full h-40 p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-none transition-all"
            />
          ) : (
            <div 
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                "w-full h-40 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors",
                isDragging 
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10" 
                  : "border-zinc-300 dark:border-zinc-700 hover:border-indigo-500 dark:hover:border-indigo-500 bg-zinc-50 dark:bg-zinc-950"
              )}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept={dataType === 'image' ? 'image/png, image/jpeg' : 'audio/mp3, audio/wav'}
                className="hidden"
              />
              {fileInput ? (
                <div className="text-center">
                  <p className="font-medium text-indigo-600 dark:text-indigo-400">{fileInput.name}</p>
                  <p className="text-sm text-zinc-500 mt-1">{(fileInput.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              ) : (
                <div className="text-center text-zinc-500">
                  <p className="font-medium mb-1">Click to upload {dataType}</p>
                  <p className="text-sm">Max size: 10MB</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Key Input */}
        <div className="mb-8">
          <label className="block text-sm font-medium mb-2">Encryption Key</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Key className="w-4 h-4 text-zinc-400" />
              </div>
              <input
                type="text"
                value={encryptionKey}
                onChange={(e) => setEncryptionKey(e.target.value)}
                placeholder="Enter a strong key..."
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
              />
            </div>
            <button
              onClick={handleGenerateKey}
              className="px-4 py-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium transition-colors flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              <span className="hidden sm:inline">Generate</span>
            </button>
          </div>
          
          {/* Key Strength Indicator */}
          {encryptionKey && (
            <div className="mt-3 flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                <div 
                  className={cn(
                    "h-full transition-all duration-300",
                    keyStrength < 40 ? "bg-red-500" : keyStrength < 80 ? "bg-amber-500" : "bg-emerald-500"
                  )}
                  style={{ width: `${keyStrength}%` }}
                />
              </div>
              <span className="text-xs font-medium text-zinc-500">
                {keyStrength < 40 ? "Weak" : keyStrength < 80 ? "Good" : "Strong"}
              </span>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-xl flex items-center gap-3 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            {error}
          </div>
        )}

        <button
          onClick={handleEncrypt}
          disabled={isEncrypting || (!textInput && !fileInput)}
          className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium text-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isEncrypting ? (
            <RefreshCw className="w-5 h-5 animate-spin" />
          ) : (
            <Lock className="w-5 h-5" />
          )}
          {isEncrypting ? 'Encrypting...' : 'Encrypt Data'}
        </button>

        {/* Result Area */}
        {encryptedResult && (
          <div className="mt-10 pt-10 border-t border-zinc-200 dark:border-zinc-800 animate-in fade-in slide-in-from-bottom-4">
            <h3 className="text-lg font-medium mb-4">Encrypted Result</h3>
            
            <div className="relative">
              <textarea
                readOnly
                value={encryptedResult}
                className="w-full h-32 p-4 pr-12 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm font-mono text-zinc-600 dark:text-zinc-400 resize-none outline-none"
              />
              <button
                onClick={handleCopy}
                className="absolute top-4 right-4 p-2 bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                title="Copy to clipboard"
              >
                {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-4 mt-6">
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-sm font-medium transition-colors"
              >
                <Download className="w-4 h-4" />
                Download as File
              </button>
              
              <button
                onClick={handleShare}
                disabled={isSharing}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {isSharing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                Share via Link
              </button>
              
              <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400 cursor-pointer ml-auto">
                <input 
                  type="checkbox" 
                  checked={autoClear}
                  onChange={(e) => setAutoClear(e.target.checked)}
                  className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                />
                Auto-clear clipboard (1m)
              </label>
            </div>

            {shareLink && (
              <div className="mt-6 p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-900/50 rounded-xl flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 overflow-hidden">
                  <Link className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-sm font-medium text-emerald-800 dark:text-emerald-200 truncate">
                    {shareLink}
                  </span>
                </div>
                <button
                  onClick={handleCopyLink}
                  className="p-2 bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors shrink-0"
                  title="Copy link"
                >
                  {copiedLink ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            )}

            {encryptedResult.length <= 2000 ? (
              <div className="mt-8 flex flex-col items-center p-6 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800">
                <p className="text-sm text-zinc-500 mb-4 text-center">Scan to copy encrypted data</p>
                <div className="bg-white p-4 rounded-xl shadow-sm">
                  <QRCodeSVG value={encryptedResult} size={160} />
                </div>
              </div>
            ) : (
              <div className="mt-8 flex flex-col items-center p-6 bg-amber-50 dark:bg-amber-500/10 rounded-2xl border border-amber-200 dark:border-amber-900/50">
                <AlertCircle className="w-6 h-6 text-amber-600 dark:text-amber-400 mb-2" />
                <p className="text-sm text-amber-800 dark:text-amber-200 text-center font-medium">
                  Encrypted result is too long for a QR code.
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300 text-center mt-1">
                  You can still copy the text above, download it as a file, or share it via link.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
