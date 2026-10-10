import { InvestigationPage } from '../../../components/InvestigationPage';

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ start?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <InvestigationPage key={id} id={id} autoStart={query.start === '1'} />;
}
