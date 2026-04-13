// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'

import { createRendererI18n } from '@renderer/i18n'

import { DossierContactsSection } from '../DossierContactsSection'

const writeText = vi.fn(async () => undefined)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

beforeEach(() => {
  writeText.mockClear()
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText
    }
  })
})

async function renderSection(
  options: {
    dossierName?: string
    entries?: React.ComponentProps<typeof DossierContactsSection>['entries']
    onSave?: React.ComponentProps<typeof DossierContactsSection>['onSave']
    onDelete?: React.ComponentProps<typeof DossierContactsSection>['onDelete']
  } = {}
): Promise<void> {
  const i18n = await createRendererI18n('en')

  render(
    <I18nextProvider i18n={i18n}>
      <DossierContactsSection
        dossierId="dos-1"
        dossierName={options.dossierName ?? 'Client Alpha'}
        entries={options.entries ?? []}
        error={null}
        isLoading={false}
        disabled={false}
        onSave={options.onSave ?? vi.fn(async () => true)}
        onDelete={options.onDelete ?? vi.fn(async () => true)}
      />
    </I18nextProvider>
  )
}

describe('DossierContactsSection', () => {
  it('shows the add form when the Add Contact button is clicked', async () => {
    await renderSection()

    expect(screen.queryByLabelText('Last name')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Add Contact' }))

    expect(screen.getByLabelText('Last name')).toBeTruthy()
    expect(screen.getByLabelText('Role')).toBeTruthy()
  })

  it('shows the add form when the empty-state button is clicked', async () => {
    await renderSection()

    fireEvent.click(screen.getByText('No contact yet. Add the first one ->'))

    expect(screen.getByLabelText('Last name')).toBeTruthy()
  })

  it('submits successfully when no fields are filled (all fields are optional)', async () => {
    const onSave = vi.fn(async () => true)
    const { container } = render(
      <I18nextProvider i18n={await createRendererI18n('en')}>
        <DossierContactsSection
          dossierId="dos-1"
          dossierName="Client Alpha"
          entries={[]}
          error={null}
          isLoading={false}
          disabled={false}
          onSave={onSave}
          onDelete={vi.fn(async () => true)}
        />
      </I18nextProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add Contact' }))

    const form = container.querySelector('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dossierId: 'dos-1' }))
    })
  })

  it('calls onSave and collapses the form on successful submission', async () => {
    const onSave = vi.fn(async () => true)
    await renderSection({ onSave })

    fireEvent.click(screen.getByRole('button', { name: 'Add Contact' }))

    fireEvent.change(screen.getByLabelText('Last name'), {
      target: { value: 'Martin' }
    })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Client' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ dossierId: 'dos-1', lastName: 'Martin', role: 'Client' })
      )
    })

    await waitFor(() => {
      expect(screen.queryByLabelText('Last name')).toBeNull()
    })
  })

  it('renders existing contacts with name and role, and calls onDelete when delete is clicked', async () => {
    const onDelete = vi.fn(async () => true)
    await renderSection({
      entries: [
        {
          uuid: 'c-1',
          dossierId: 'dos-1',
          firstName: 'Camille',
          lastName: 'Martin',
          role: 'Client',
          information: 'Primary client contact and settlement point of contact.'
        }
      ],
      onDelete
    })

    expect(screen.getByText('Camille Martin')).toBeTruthy()
    expect(screen.getByText('Client')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith({ dossierId: 'dos-1', contactUuid: 'c-1' })
    })
  })

  it('pre-fills the form when editing a contact', async () => {
    await renderSection({
      entries: [
        {
          uuid: 'c-1',
          dossierId: 'dos-1',
          firstName: 'Camille',
          lastName: 'Martin',
          role: 'Client',
          institution: 'Martin SARL',
          information: 'Client liaison for approvals'
        }
      ]
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Camille')
    expect((screen.getByLabelText('Last name') as HTMLInputElement).value).toBe('Martin')
    expect((screen.getByLabelText('Role') as HTMLInputElement).value).toBe('Client')
    expect((screen.getByLabelText('Institution') as HTMLInputElement).value).toBe('Martin SARL')
    expect((screen.getByLabelText('Context') as HTMLTextAreaElement).value).toBe(
      'Client liaison for approvals'
    )
  })

  it('renders a dossier-specific delegated prompt and copies it', async () => {
    vi.useFakeTimers()
    await renderSection({ dossierName: 'Client Alpha' })

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Add via AI section' }))

    expect(screen.getByText(/In dossier 'Client Alpha', add the following contacts:/)).toBeTruthy()
    expect(screen.getByText(/\[paste contact details here\]/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }))

    await Promise.resolve()
    const copiedText = String((writeText.mock.calls as unknown[][])[0]?.[0] ?? '')

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(copiedText).toContain("In dossier 'Client Alpha', add the following contacts:")
    expect(copiedText).toContain('[paste contact details here]')

    expect(screen.getByRole('button', { name: 'Copy prompt' })).toBeTruthy()
  })
})
