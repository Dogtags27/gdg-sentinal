import { useEffect, useState } from 'react';

// Tiny hash router.
//   #/                landing (choose a role)
//   #/help            ticket creator
//   #/console  #/view/escalated  #/board  #/insights  #/ticket/TKT-00042   incident manager
const decode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

function parse() {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'ticket' && parts[1]) return { page: 'ticket', id: decode(parts[1]) };
  if (parts[0] === 'view' && parts[1]) return { page: 'dashboard', view: decode(parts[1]) };
  if (parts[0] === 'board') return { page: 'board' };
  if (parts[0] === 'insights') return { page: 'insights' };
  if (parts[0] === 'help') return { page: 'help' };
  if (parts[0] === 'console') return { page: 'dashboard' };
  return { page: 'landing' };
}

export function useHashRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (path) => {
  window.location.hash = path;
};
export const ticketHref = (id) => `#/ticket/${encodeURIComponent(id)}`;
