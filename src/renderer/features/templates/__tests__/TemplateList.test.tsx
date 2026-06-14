// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TemplateRecord } from '@shared/types'
import { createRendererI18n } from '@renderer/i18n'

import { TemplateList } from '../TemplateList'

function createTemplate(overrides: Partial<TemplateRecord> = {}): TemplateRecord {
  return {
    uuid: 'tpl-1',
    name: 'Convocation',
    macros: [],
    hasDocxSource: false,
    updatedAt: '2026-06-12T10:00:00.000Z',
    ...overrides
  }
}

async function renderList(
  templates: TemplateRecord[],
  onMoveToCategory = vi.fn(async () => undefined)
): Promise<ReturnType<typeof vi.fn>> {
  const i18n = await createRendererI18n('fr')
  render(
    <I18nextProvider i18n={i18n}>
      <TemplateList
        isLoading={false}
        templates={templates}
        onCreate={vi.fn()}
        onDelete={vi.fn(async () => undefined)}
        onEdit={vi.fn()}
        onMacros={vi.fn()}
        onOpenLibrary={vi.fn()}
        onMoveToCategory={onMoveToCategory}
      />
    </I18nextProvider>
  )
  return onMoveToCategory
}

afterEach(() => {
  cleanup()
})

/** The category appears both as a section header and as a per-row badge — pick the header li. */
function getCategoryHeader(label: string): HTMLElement {
  const header = screen
    .getAllByText(label)
    .map((el) => el.closest('li'))
    .find((li) => li?.className.includes('uppercase'))
  if (!header) throw new Error(`No section header found for "${label}"`)
  return header
}

describe('TemplateList categories', () => {
  it('groups templates under category headers with the uncategorized section last', async () => {
    await renderList([
      createTemplate({ uuid: 'a', name: 'Assignation', category: 'Procédure' }),
      createTemplate({ uuid: 'b', name: 'Convocation' }),
      createTemplate({ uuid: 'c', name: 'Conclusions', category: 'Procédure' })
    ])

    expect(getCategoryHeader('Procédure')).toBeTruthy()
    expect(getCategoryHeader('Sans catégorie')).toBeTruthy()
    expect(screen.getByText('(2)')).toBeTruthy()
    expect(screen.getByText('(1)')).toBeTruthy()
  })

  it('shows no headers while no template is categorized', async () => {
    await renderList([createTemplate({ uuid: 'a' }), createTemplate({ uuid: 'b', name: 'Autre' })])
    expect(screen.queryByText('Sans catégorie')).toBeNull()
  })

  it('moves a template on drop over a category header', async () => {
    const onMoveToCategory = await renderList([
      createTemplate({ uuid: 'a', name: 'Assignation', category: 'Procédure' }),
      createTemplate({ uuid: 'b', name: 'Convocation' })
    ])

    const row = screen.getByText('Convocation').closest('li') as HTMLElement
    fireEvent.dragStart(row, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } })

    // The dragging state is deferred to the next tick (Chromium dragstart workaround)
    await waitFor(() => {
      expect(screen.getByText(/Déposer ici pour créer une nouvelle catégorie/)).toBeTruthy()
    })

    const header = getCategoryHeader('Procédure')
    fireEvent.dragOver(header)
    fireEvent.drop(header)

    await waitFor(() => {
      expect(onMoveToCategory).toHaveBeenCalledWith('b', 'Procédure')
    })
  })

  it('asks for a name when dropping on the new-category zone and submits it', async () => {
    const onMoveToCategory = await renderList([
      createTemplate({ uuid: 'a', name: 'Assignation', category: 'Procédure' }),
      createTemplate({ uuid: 'b', name: 'Convocation' })
    ])

    const row = screen.getByText('Convocation').closest('li') as HTMLElement
    fireEvent.dragStart(row, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } })

    await waitFor(() => {
      expect(screen.getByText(/Déposer ici pour créer une nouvelle catégorie/)).toBeTruthy()
    })

    const zone = screen
      .getByText(/Déposer ici pour créer une nouvelle catégorie/)
      .closest('li') as HTMLElement
    fireEvent.dragOver(zone)
    fireEvent.drop(zone)

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'Correspondance' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(onMoveToCategory).toHaveBeenCalledWith('b', 'Correspondance')
    })
  })
})
