import React, { createContext, useContext, useState } from 'react';
import { live } from '../domain/records';
import { Chip } from './components/kit';
import { useData } from './vault';

/** Family view: everyone, or one owner. Shared by Home and Invest. */
const OwnerContext = createContext<{ ownerId: string | null; setOwnerId: (id: string | null) => void }>({ ownerId: null, setOwnerId: () => {} });

export const OwnerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ownerId, setOwnerId] = useState<string | null>(null);
  return <OwnerContext.Provider value={{ ownerId, setOwnerId }}>{children}</OwnerContext.Provider>;
};

export function useOwner() {
  return useContext(OwnerContext);
}

export const OwnerChips: React.FC = () => {
  const data = useData();
  const { ownerId, setOwnerId } = useOwner();
  const owners = live(data.owners);
  if (owners.length < 2) return null;
  return (
    <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 no-scrollbar">
      <Chip active={ownerId === null} onClick={() => setOwnerId(null)}>Family</Chip>
      {owners.map(o => <Chip key={o.id} active={ownerId === o.id} onClick={() => setOwnerId(o.id)}>{o.name}</Chip>)}
    </div>
  );
};
