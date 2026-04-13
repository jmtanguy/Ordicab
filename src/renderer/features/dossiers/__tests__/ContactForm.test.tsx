import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'

import { createRendererI18n } from '@renderer/i18n'

import { ContactForm } from '../ContactForm'
import { validateContactFormInput } from '../contactFormValidation'

describe('ContactForm', () => {
  it('renders required dossier contact fields and actions', async () => {
    const i18n = await createRendererI18n('en')

    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ContactForm
          dossierId="dos-1"
          disabled={false}
          onCancel={() => undefined}
          onSubmit={async () => true}
        />
      </I18nextProvider>
    )

    expect(markup).toContain('Add a dossier contact')
    expect(markup).toContain('Role')
    expect(markup).toContain('Institution')
    expect(markup).toContain('Gender')
    expect(markup).toContain('Monsieur')
    expect(markup).toContain('Madame')
    expect(markup).toContain('Neutral')
    expect(markup).toContain('Additional civil first names')
    expect(markup).toContain('Address')
    expect(markup).toContain('Phone')
    expect(markup).toContain('Email')
    expect(markup).toContain('Context')
    expect(markup).toContain('Save contact')
  })

  it('validates contact form input: blocks invalid email, normalizes birth dates, and blocks invalid dates', () => {
    const msgs = {
      required: 'This field is required.',
      invalidEmail: 'Enter a valid email address.',
      invalidDate: 'Enter a valid date.'
    }

    // empty fields succeed (all optional)
    expect(
      validateContactFormInput(
        {
          dossierId: 'dos-1',
          title: '',
          firstName: '',
          additionalFirstNames: '',
          lastName: '',
          gender: '',
          displayName: '',
          role: '',
          institution: '',
          addressLine: '',
          addressLine2: '',
          zipCode: '',
          city: '',
          country: '',
          phone: '',
          email: '',
          dateOfBirth: '',
          countryOfBirth: '',
          nationality: '',
          occupation: '',
          socialSecurityNumber: '',
          maidenName: '',
          information: ''
        },
        msgs,
        { locale: 'en-GB' }
      )
    ).toEqual({ success: true, data: expect.objectContaining({ dossierId: 'dos-1' }) })

    // invalid email blocked
    expect(
      validateContactFormInput(
        {
          dossierId: 'dos-1',
          title: '',
          firstName: 'Camille',
          additionalFirstNames: 'Jeanne Louise',
          lastName: 'Martin',
          gender: 'F',
          displayName: 'Camille Martin',
          role: 'Client',
          institution: '',
          addressLine: '',
          addressLine2: '',
          zipCode: '',
          city: '',
          country: '',
          phone: '',
          email: 'not-an-email',
          dateOfBirth: '',
          countryOfBirth: '',
          nationality: '',
          occupation: '',
          socialSecurityNumber: '',
          maidenName: '',
          information: ''
        },
        msgs,
        { locale: 'en-GB' }
      )
    ).toEqual({ success: false, errors: { email: 'Enter a valid email address.' } })

    // fr locale: local date normalized to ISO
    expect(
      validateContactFormInput(
        {
          dossierId: 'dos-1',
          title: '',
          firstName: 'Camille',
          additionalFirstNames: '',
          lastName: 'Martin',
          gender: '',
          displayName: 'Camille Martin',
          role: 'Client',
          institution: '',
          addressLine: '',
          addressLine2: '',
          zipCode: '',
          city: '',
          country: '',
          phone: '',
          email: '',
          dateOfBirth: '31/12/2024',
          countryOfBirth: '',
          nationality: '',
          occupation: '',
          socialSecurityNumber: '',
          maidenName: '',
          information: ''
        },
        msgs,
        { locale: 'fr' }
      )
    ).toEqual({
      success: true,
      data: expect.objectContaining({
        dossierId: 'dos-1',
        firstName: 'Camille',
        lastName: 'Martin',
        customFields: expect.objectContaining({
          dateOfBirth: '2024-12-31'
        })
      })
    })

    // fr locale: invalid date blocked
    expect(
      validateContactFormInput(
        {
          dossierId: 'dos-1',
          title: '',
          firstName: 'Camille',
          additionalFirstNames: '',
          lastName: 'Martin',
          gender: '',
          displayName: 'Camille Martin',
          role: 'Client',
          institution: '',
          addressLine: '',
          addressLine2: '',
          zipCode: '',
          city: '',
          country: '',
          phone: '',
          email: '',
          dateOfBirth: '31/31/2024',
          countryOfBirth: '',
          nationality: '',
          occupation: '',
          socialSecurityNumber: '',
          maidenName: '',
          information: ''
        },
        msgs,
        { locale: 'fr' }
      )
    ).toEqual({ success: false, errors: { dateOfBirth: 'Enter a valid date.' } })
  })

  it('formats an ISO birth date for local display when editing', async () => {
    const i18n = await createRendererI18n('fr')

    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ContactForm
          dossierId="dos-1"
          disabled={false}
          initialValue={{
            displayName: 'Camille Martin',
            customFields: {
              dateOfBirth: '2024-12-31'
            }
          }}
          onCancel={() => undefined}
          onSubmit={async () => true}
        />
      </I18nextProvider>
    )

    expect(markup).toContain('value="31/12/2024"')
  })
})
