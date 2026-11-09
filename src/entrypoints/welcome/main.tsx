import { createRoot } from 'react-dom/client';
import '@/ui/styles.css';
import { Welcome } from '@/ui/Welcome';

createRoot(document.getElementById('root')!).render(<Welcome />);
