// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRendererI18n } from '@renderer/i18n'
import { useEntityStore } from '@renderer/stores'

import { TagReferencePanel } from '../TagReferencePanel'

afterEach(() => {
  cleanup()
  useEntityStore.setState(useEntityStore.getInitialState(), true)
})

async function renderPanel(
  onInsertTag = vi.fn(),
  options: { referenceMode?: boolean } = {}
): Promise<ReturnType<typeof vi.fn>> {
  const i18n = await createRendererI18n('en')

  render(
    <I18nextProvider i18n={i18n}>
      <TagReferencePanel onInsertTag={onInsertTag} referenceMode={options.referenceMode} />
    </I18nextProvider>
  )

  return onInsertTag
}

describe('TagReferencePanel', () => {
  it('renders grouped tags with syntax and description', async () => {
    await renderPanel()

    expect(screen.getByText('Insert Macro')).toBeTruthy()
    expect(screen.getByText('{{dossier.name}}')).toBeTruthy()
    expect(screen.getByText('Primary dossier title')).toBeTruthy()
  })

  it('fires onInsertTag with the selected tag', async () => {
    const onInsertTag = await renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /{{entity\.firmName}}/i }))

    expect(onInsertTag).toHaveBeenCalledWith('{{entity.firmName}}')
  })

  it('animates the clicked row in reference mode after copy', async () => {
    const onInsertTag = await renderPanel(vi.fn(), { referenceMode: true })

    const button = screen.getByRole('button', { name: /{{entity\.firmName}}/i })
    fireEvent.click(button)

    expect(onInsertTag).toHaveBeenCalledWith('{{entity.firmName}}')
    await waitFor(() => expect(button.getAttribute('data-copied')).toBe('true'))
  })

  it('does not confirm copy when reference mode copy fails', async () => {
    const onInsertTag = await renderPanel(vi.fn().mockResolvedValue(false), { referenceMode: true })

    const button = screen.getByRole('button', { name: /{{entity\.firmName}}/i })
    fireEvent.click(button)

    await waitFor(() => expect(onInsertTag).toHaveBeenCalledWith('{{entity.firmName}}'))
    expect(button.getAttribute('data-copied')).toBe('false')
  })

  it('shows all key date format variants for a dynamic label', async () => {
    await renderPanel()

    fireEvent.change(screen.getByPlaceholderText('E.g.: Hearing, Deliberation…'), {
      target: { value: 'Hearing Date' }
    })

    expect(screen.getByText('{{dossier.keyDate.hearingDate}}')).toBeTruthy()
    expect(screen.getByText('{{dossier.keyDate.hearingDate.formatted}}')).toBeTruthy()
    expect(screen.getByText('{{dossier.keyDate.hearingDate.long}}')).toBeTruthy()
    expect(screen.getByText('{{dossier.keyDate.hearingDate.short}}')).toBeTruthy()
    expect(screen.getByText('{{dossier.keyDate.hearingDate.label}}')).toBeTruthy()
  })

  it('shows default variant placeholder buttons when no key date label is typed', async () => {
    await renderPanel()

    // All 5 placeholders are displayed before the author chooses a label,
    // including the raw ISO entry without a variant suffix.
    expect(screen.getByText('{{dossier.keyDate}}')).toBeTruthy()
    expect(screen.getByText('{{dossier.keyDate.formatted}}')).toBeTruthy()
    expect(screen.getByText('{{dossier.keyDate.long}}')).toBeTruthy()
    expect(screen.getByText('{{dossier.keyDate.short}}')).toBeTruthy()
    expect(screen.getByText('{{dossier.keyDate.label}}')).toBeTruthy()
  })

  it('renders groups in the expected order and generates contact role tags on the fly', async () => {
    useEntityStore.setState({
      profile: {
        firmName: 'Cabinet Martin',
        managedFields: {
          contactRoles: ['client', 'expert'],
          contacts: [],
          keyDates: [],
          keyReferences: [],
          contactRoleFields: {}
        }
      }
    })

    const onInsertTag = await renderPanel()

    const headings = screen.getAllByRole('heading', { level: 5 }).map((node) => node.textContent)
    expect(headings).toEqual([
      'Timeline',
      'Contact',
      'Dossier',
      'Entity',
      'System',
      'Fee Agreement',
      'Invoice'
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Client' }))
    fireEvent.click(screen.getByRole('button', { name: /{{contact\.client\.displayName}}/i }))

    expect(onInsertTag).toHaveBeenCalledWith('{{contact.client.displayName}}')
  })
})
