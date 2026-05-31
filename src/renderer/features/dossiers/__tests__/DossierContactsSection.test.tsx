// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'

import { createRendererI18n } from '@renderer/i18n'
import { useEntityStore } from '@renderer/stores'

import { DossierContactsSection } from '../DossierContactsSection'

afterEach(() => {
  cleanup()
  useEntityStore.setState(useEntityStore.getInitialState(), true)
  vi.useRealTimers()
})

async function renderSection(
  options: {
    entries?: React.ComponentProps<typeof DossierContactsSection>['entries']
    onSave?: React.ComponentProps<typeof DossierContactsSection>['onSave']
    onDelete?: React.ComponentProps<typeof DossierContactsSection>['onDelete']
  } = {}
): Promise<ReturnType<typeof render>> {
  const i18n = await createRendererI18n('en')

  return render(
    <I18nextProvider i18n={i18n}>
      <DossierContactsSection
        dossierId="dos-1"
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

  it('renders custom fields as ordered label/value rows and keeps them searchable', async () => {
    useEntityStore.setState({
      profile: {
        firmName: 'Cabinet Martin',
        managedFields: {
          contactRoles: [],
          contacts: [
            { label: 'Date of birth', type: 'date' },
            { label: 'Nationality', type: 'text' }
          ],
          keyDates: [],
          keyReferences: [],
          contactRoleFields: {}
        }
      }
    })

    const { container } = await renderSection({
      entries: [
        {
          uuid: 'c-1',
          dossierId: 'dos-1',
          firstName: 'Camille',
          lastName: 'Martin',
          customFields: {
            unknownField: 'Legacy value',
            nationality: 'French',
            dateOfBirth: '01/01/1990'
          }
        },
        {
          uuid: 'c-2',
          dossierId: 'dos-1',
          firstName: 'Alex',
          lastName: 'Durand'
        }
      ]
    })

    expect([...container.querySelectorAll('dl > div')].map((row) => row.textContent)).toEqual([
      'Date of birth01/01/1990',
      'NationalityFrench',
      'unknownFieldLegacy value'
    ])

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), {
      target: { value: 'Nationality' }
    })

    expect(screen.getByText('Camille Martin')).toBeTruthy()
    expect(screen.queryByText('Alex Durand')).toBeNull()
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
})
