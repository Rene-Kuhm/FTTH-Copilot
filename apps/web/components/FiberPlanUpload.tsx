'use client';

import { useCallback, useRef, useState } from 'react';

interface FiberPlanUploadProps {
  onClose: () => void;
  onUploaded: (plan: { id: string; name: string; fileUrl: string }) => void;
}

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'application/pdf'];
const ACCEPTED_EXTENSIONS = '.png, .jpg, .jpeg, .gif, .webp, .svg, .pdf';

export default function FiberPlanUpload({ onClose, onUploaded }: FiberPlanUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setError(`Tipo de archivo no soportado: ${f.type}`);
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setError('El archivo excede el límite de 50 MB.');
      return;
    }
    setError(null);
    setFile(f);
    if (f.type.startsWith('image/')) {
      setPreview(URL.createObjectURL(f));
      if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
    }
  }, [name]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  }, [handleFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) handleFile(selected);
  }, [handleFile]);

  const handleSubmit = useCallback(async () => {
    if (!file) { setError('Seleccioná un archivo.'); return; }
    if (!name.trim()) { setError('El nombre es obligatorio.'); return; }

    setUploading(true);
    setError(null);

    try {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('description', description.trim());
      fd.append('file', file);

      const res = await fetch('/api/fiber-plans', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Error ${res.status}`);
        return;
      }

      onUploaded(body.plan);
      onClose();
    } catch {
      setError('Error de red al subir el archivo.');
    } finally {
      setUploading(false);
    }
  }, [file, name, description, onUploaded, onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: 'var(--color-surface-elev)',
          borderRadius: 20,
          padding: 28,
          width: '100%',
          maxWidth: 520,
          boxShadow: 'var(--shadow-card)',
          fontFamily: 'var(--font-body)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}>
            Subir plano de fibra
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-muted)',
              fontSize: 22,
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--color-accent)' : 'var(--color-border)'}`,
            borderRadius: 12,
            padding: 32,
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            background: dragOver ? 'rgba(242,48,119,0.06)' : 'transparent',
            marginBottom: 16,
          }}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt="Preview"
              style={{ maxHeight: 160, maxWidth: '100%', borderRadius: 8, objectFit: 'contain' }}
            />
          ) : (
            <>
              <div style={{ fontSize: 32, marginBottom: 8 }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto' }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <p style={{ margin: '0 0 4px', fontSize: 14, color: 'var(--color-text)' }}>
                Arrastrá el archivo o hacé click para seleccionar
              </p>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--color-muted)' }}>
                PNG, JPEG, SVG, GIF, WebP, PDF — hasta 50 MB
              </p>
            </>
          )}
          {file && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--color-muted)' }}>
              {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
            </p>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />

        {/* Fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 4 }}>
              Nombre *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Plano Norte — Barrio El Progreso"
              maxLength={255}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                fontSize: 14,
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 4 }}>
              Descripción
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Zonas cubiertas, fecha del relevamiento, observaciones..."
              maxLength={1000}
              rows={2}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                fontSize: 14,
                boxSizing: 'border-box',
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'var(--font-body)',
              }}
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              background: 'rgba(248,113,113,0.1)',
              border: '1px solid rgba(248,113,113,0.3)',
              color: 'var(--color-danger)',
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={uploading}
            style={{
              padding: '8px 20px',
              borderRadius: 10,
              border: '1px solid var(--color-border)',
              background: 'transparent',
              color: 'var(--color-text)',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={uploading || !file || !name.trim()}
            style={{
              padding: '8px 20px',
              borderRadius: 10,
              border: 'none',
              background: file && name.trim() ? 'var(--color-accent)' : 'var(--color-muted)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: file && name.trim() ? 'pointer' : 'not-allowed',
              opacity: uploading ? 0.7 : 1,
              transition: 'all 0.15s ease',
            }}
          >
            {uploading ? 'Subiendo…' : 'Subir plano'}
          </button>
        </div>
      </div>
    </div>
  );
}
