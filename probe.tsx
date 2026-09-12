import React from 'react'
import {renderToString} from 'ink'
import {Logo} from './src/components/logo.tsx'
const out = renderToString(<Logo themeMode="dark" />)
console.log('PLAIN>>>\n' + out.replace(/\u001b\[[0-9;]*m/g, ''))
