import { Box, Text, useInput } from 'ink'
import React, { useState } from 'react'
import type { ProjectCollection } from '../../core/project-scan.js'
import type { Size } from '../components/Frame.js'
import { Table } from '../components/Table.js'
import { type Nav, useBack } from './index.js'

export function Collections({ nav, rows, size }: { nav: Nav; rows: ProjectCollection[]; size: Size }) {
  const [selected, setSelected] = useState(0)
  const [shown, setShown] = useState<string>()
  useBack(nav)

  useInput((input, key) => {
    if (key.upArrow || input === 'k') setSelected((i) => Math.max(0, i - 1))
    else if (key.downArrow || input === 'j') setSelected((i) => Math.min(rows.length - 1, i + 1))
    else if (key.return && rows[selected]) setShown(`src/${rows[selected]!.file}`)
    else if (input === 'n') nav.push({ name: 'builder', kind: 'collection' })
    else if (input === 'x') nav.push({ name: 'access' })
  })

  return (
    <Box flexDirection="column">
      <Table
        headers={['COLLECTION', 'TENANT-SCOPED', 'FIELDS', 'FILE']}
        rows={rows.map((r) => [r.slug, r.tenantScoped ? 'yes' : 'no', String(r.fieldCount), r.file])}
        selected={selected}
        height={Math.max(5, size.rows - 12)}
        empty="No collections found in src/collections."
      />
      {shown ? <Text color="green">{shown}</Text> : null}
      <Text dimColor>↑↓ move · Enter show file · n new collection · x access · Esc back</Text>
    </Box>
  )
}
