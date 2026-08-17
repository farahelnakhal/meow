import React from 'react';
import RootNavigator from './src/navigation/RootNavigator';
import { ActiveProfileProvider } from './src/store/activeProfile';

export default function App() {
  return (
    <ActiveProfileProvider>
      <RootNavigator />
    </ActiveProfileProvider>
  );
}