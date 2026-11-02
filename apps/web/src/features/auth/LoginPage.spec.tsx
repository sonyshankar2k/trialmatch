import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { aliceAuth, pageOf } from '../../testing/fixtures';
import { renderApp } from '../../testing/render';
import { server } from '../../testing/server';

describe('LoginPage', () => {
  it('sends a signed-out visitor to sign in, then back to where they were going', async () => {
    let sentBody: unknown;
    server.use(
      http.post('*/api/auth/login', async ({ request }) => {
        sentBody = await request.json();
        return HttpResponse.json(aliceAuth);
      }),
      http.get('*/api/patients', () =>
        HttpResponse.json({ ...pageOf([]), items: [] }),
      ),
    );
    const { user } = renderApp('/patients', { signedIn: false });

    await user.type(
      await screen.findByLabelText('Email'),
      ' Alice@TrialMatch.dev ',
    );
    await user.type(screen.getByLabelText('Password'), 'trialmatch-demo');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Patients' }),
    ).toBeInTheDocument();
    // The shared schema normalised the email before it was sent.
    expect(sentBody).toEqual({
      email: 'alice@trialmatch.dev',
      password: 'trialmatch-demo',
    });
  });

  it('shows validation messages without calling the API', async () => {
    const { user } = renderApp('/login', { signedIn: false });
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('shows the server message for wrong credentials', async () => {
    server.use(
      http.post('*/api/auth/login', () =>
        HttpResponse.json(
          { statusCode: 401, message: 'Incorrect email or password.' },
          { status: 401 },
        ),
      ),
    );
    const { user } = renderApp('/login', { signedIn: false });
    await user.type(
      await screen.findByLabelText('Email'),
      'alice@trialmatch.dev',
    );
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByText('Incorrect email or password.'),
    ).toBeInTheDocument();
  });

  it('puts server field errors on the right field when registering', async () => {
    server.use(
      http.post('*/api/auth/register', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: 'Validation failed',
            fieldErrors: { email: 'Already registered elsewhere' },
          },
          { status: 400 },
        ),
      ),
    );
    const { user } = renderApp('/login', { signedIn: false });
    await user.click(
      await screen.findByRole('button', { name: 'Create an account' }),
    );
    await user.type(screen.getByLabelText('Your name'), 'Dana');
    await user.type(screen.getByLabelText('Email'), 'dana@example.com');
    await user.type(screen.getByLabelText('Password'), 'long-enough-password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(
      await screen.findByText('Already registered elsewhere'),
    ).toBeInTheDocument();
  });
});
