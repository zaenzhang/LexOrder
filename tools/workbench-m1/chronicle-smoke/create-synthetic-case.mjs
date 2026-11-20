export async function createSyntheticCase(request, { title, clientName, description, casebookRoot }) {
  const practiceEndpoint = "/api/personal/practice";
  const practice = async body => (await request(practiceEndpoint, body)).json();
  const client = await practice({ action: "create-client", input: { name: clientName, type: "COMPANY" } });
  const intake = await practice({ action: "create-intake", input: {
    title, category: "NON_LITIGATION", clientId: client.id, description,
  } });
  await practice({ action: "check-intake", id: intake.id });
  const { check } = await (await request(practiceEndpoint + "?" + new URLSearchParams({ view: "intake", id: intake.id }))).json();
  await practice({ action: "decide-conflict", id: check.id, conclusion: "DIFFERENT", note: "本机合成样本" });
  await practice({ action: "submit-intake", id: intake.id });
  const { matterId } = await practice({ action: "convert-intake", id: intake.id });
  await request("/api/personal/matter-folder", { matterId, action: "bind", root: casebookRoot });
  return matterId;
}
