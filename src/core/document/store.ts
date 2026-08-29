import { create } from 'zustand';

import { editorEvents } from '../events/bus';
import { newSlideId } from '../../shared/ids';
import { emptyProject, type Project, type Slide } from './model';

interface DocumentState {
  project: Project;
  filePath: string | null;
  dirty: boolean;

  loadProject(project: Project, filePath: string | null): void;
  reset(): void;

  /** Replaces a slide's markup. Called whenever the edit stage commits. */
  setSlideHtml(id: string, html: string): void;

  /** Inserts a slide, keeping the id it already has (a duplicate, or an undo). */
  insertSlide(slide: Slide, atIndex: number): void;
  duplicateSlide(id: string): string | null;
  removeSlide(id: string): void;
  moveSlide(from: number, to: number): void;

  setTitle(title: string): void;
  /** Records the HTML file the deck was last written to. */
  markSaved(filePath: string): void;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  project: emptyProject(),
  filePath: null,
  dirty: false,

  loadProject(project, filePath) {
    set({ project, filePath, dirty: false });
    editorEvents.emit('project:loaded', {
      title: project.meta.title,
      slideCount: project.slides.length,
    });
  },

  reset() {
    set({ project: emptyProject(), filePath: null, dirty: false });
  },

  setSlideHtml(id, html) {
    const { project } = get();
    const index = project.slides.findIndex((s) => s.id === id);
    if (index === -1 || project.slides[index].html === html) return;
    const slides = project.slides.slice();
    slides[index] = { ...slides[index], html };
    set({ project: touch(project, slides), dirty: true });
    editorEvents.emit('document:changed', { slideId: id });
  },


  insertSlide(slide, atIndex) {
    const { project } = get();
    const slides = project.slides.slice();
    slides.splice(clamp(atIndex, 0, slides.length), 0, slide);
    set({ project: touch(project, slides), dirty: true });
    editorEvents.emit('document:changed', { slideId: slide.id });
  },

  duplicateSlide(id) {
    const { project } = get();
    const index = project.slides.findIndex((s) => s.id === id);
    if (index === -1) return null;
    const copy: Slide = { ...project.slides[index], id: newSlideId() };
    const slides = project.slides.slice();
    slides.splice(index + 1, 0, copy);
    set({ project: touch(project, slides), dirty: true });
    editorEvents.emit('document:changed', { slideId: copy.id });
    return copy.id;
  },

  removeSlide(id) {
    const { project } = get();
    const slides = project.slides.filter((s) => s.id !== id);
    if (slides.length === project.slides.length) return;
    set({ project: touch(project, slides), dirty: true });
    editorEvents.emit('document:changed', { slideId: null });
  },

  moveSlide(from, to) {
    const { project } = get();
    const slides = project.slides.slice();
    if (from < 0 || from >= slides.length) return;
    const target = clamp(to, 0, slides.length - 1);
    if (from === target) return;
    const [moved] = slides.splice(from, 1);
    slides.splice(target, 0, moved);
    set({ project: touch(project, slides), dirty: true });
    editorEvents.emit('document:changed', { slideId: moved.id });
  },

  setTitle(title) {
    const { project } = get();
    if (project.meta.title === title) return;
    set({
      project: { ...project, meta: { ...project.meta, title } },
      dirty: true,
    });
  },

  markSaved(filePath) {
    set({ filePath, dirty: false });
    editorEvents.emit('project:saved', { path: filePath });
  },
}));

function touch(project: Project, slides: Slide[]): Project {
  return {
    ...project,
    slides,
    meta: { ...project.meta, updatedAt: new Date().toISOString() },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
