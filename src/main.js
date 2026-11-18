import { mount } from 'svelte';
import App from './App.svelte';
import './styles/base.css';
import './styles/note.css';
import './styles/halls.css';
import './styles/motion.css';

mount(App, { target: document.getElementById('app') });
