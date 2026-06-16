import { render } from 'preact';
import { App } from './App';
import '../shared/spoiler-guard.css';
import './style.css';

const container = document.getElementById('app');
if (container !== null) {
  render(<App />, container);
}
