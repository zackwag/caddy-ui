# Cloud metadata endpoint comparison

This is development reference data, not a webhook denylist. No metadata endpoint was contacted.

Source: [Canonical cloud-init `2e29ad07dace`](https://github.com/canonical/cloud-init/tree/2e29ad07daced32d3fac1cb2aa93b817fe12b291).
Scanned 65 datasource Python files; found 8 unique candidate hosts.

## Provider-documented reference

| Provider | Host | Literal found in source | Documentation |
| --- | --- | --- | --- |
| AWS EC2 | `169.254.169.254` | Yes | [Provider documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html) |
| AWS EC2 | `fd00:ec2::254` | Yes | [Provider documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html) |
| Google Compute Engine | `metadata.google.internal` | Yes | [Provider documentation](https://docs.cloud.google.com/compute/docs/metadata/querying-metadata#metadata_server_endpoints) |
| Google Compute Engine | `169.254.169.254` | Yes | [Provider documentation](https://docs.cloud.google.com/compute/docs/metadata/querying-metadata#metadata_server_endpoints) |
| Google Compute Engine | `fd20:ce::254` | **No — retain for review** | [Provider documentation](https://docs.cloud.google.com/compute/docs/metadata/querying-metadata#metadata_server_endpoints) |
| Alibaba ECS | `100.100.100.200` | Yes | [Provider documentation](https://www.alibabacloud.com/help/en/ecs/user-guide/view-instance-metadata/) |

A shared host match does not establish provider-specific coverage. Missing literals do not invalidate provider documentation.

## Source candidates

| Host | In reference | Source observations |
| --- | --- | --- |
| `100.100.100.200` | Yes | [DataSourceAliYun.py:24](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceAliYun.py#L24)<br>[helpers/aliyun.py:14](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/helpers/aliyun.py#L14)<br>[helpers/aliyun.py:98](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/helpers/aliyun.py#L98) |
| `169.254.169.254` | Yes | [DataSourceAkamai.py:23](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceAkamai.py#L23)<br>[DataSourceCloudCIX.py:11](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceCloudCIX.py#L11)<br>[DataSourceDigitalOcean.py:18](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceDigitalOcean.py#L18)<br>[DataSourceEc2.py:87](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceEc2.py#L87)<br>[DataSourceExoscale.py:13](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceExoscale.py#L13)<br>[DataSourceHetzner.py:42](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceHetzner.py#L42)<br>[DataSourceNWCS.py:15](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceNWCS.py#L15)<br>[DataSourceOpenStack.py:81](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceOpenStack.py#L81)<br>[DataSourceOracle.py:49](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceOracle.py#L49)<br>[DataSourceUpCloud.py:18](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceUpCloud.py#L18)<br>[DataSourceVultr.py:16](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceVultr.py#L16)<br>[azure/imds.py:18](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/azure/imds.py#L18)<br>[helpers/ec2.py:146](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/helpers/ec2.py#L146)<br>[helpers/ec2.py:187](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/helpers/ec2.py#L187)<br>[helpers/ec2.py:237](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/helpers/ec2.py#L237)<br>[helpers/ec2.py:266](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/helpers/ec2.py#L266) |
| `169.254.42.42` | No — verify with provider | [DataSourceScaleway.py:31](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceScaleway.py#L31) |
| `fd00:42::42` | No — verify with provider | [DataSourceScaleway.py:31](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceScaleway.py#L31) |
| `fd00:a9fe:a9fe::1` | No — verify with provider | [DataSourceAkamai.py:24](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceAkamai.py#L24) |
| `fd00:c1::a9fe:a9fe` | No — verify with provider | [DataSourceOracle.py:50](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceOracle.py#L50) |
| `fd00:ec2::254` | Yes | [DataSourceEc2.py:88](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceEc2.py#L88) |
| `metadata.google.internal` | Yes | [DataSourceGCE.py:19](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceGCE.py#L19)<br>[DataSourceGCE.py:22](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceGCE.py#L22) |

## Manual review

Dynamic authorities, scoped IPv6 and other hostname URLs are listed below. Some are documentation or local transport URLs, not metadata endpoints.

| Source | Expression |
| --- | --- |
| [DataSourceCloudStack.py:52](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceCloudStack.py#L52) | `f"http://{self.virtual_router_address}:8080"` |
| [DataSourceCloudStack.py:238](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceCloudStack.py#L238) | `f"http://{self.vr_addr}/"` |
| [DataSourceHetzner.py:41](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceHetzner.py#L41) | `f"http://[fe80::a9fe:a9fe%25{net.find_fallback_nic()}]/hetzner/v1/"` |
| [DataSourceLXD.py:34](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceLXD.py#L34) | `http://lxd` |
| [DataSourceNoCloud.py:319](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceNoCloud.py#L319) | `http://` |
| [DataSourceNoCloud.py:319](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceNoCloud.py#L319) | `https://` |
| [DataSourceNoCloud.py:398](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceNoCloud.py#L398) | `http://` |
| [DataSourceNoCloud.py:399](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceNoCloud.py#L399) | `https://` |
| [DataSourceOVF.py:138](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceOVF.py#L138) | `http://` |
| [DataSourceOVF.py:138](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceOVF.py#L138) | `https://` |
| [DataSourceOVF.py:367](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceOVF.py#L367) | `http://schemas.dmtf.org/ovf/environment/1` |
| [DataSourceOpenStack.py:78](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceOpenStack.py#L78) | `http://[fe80::a9fe:a9fe%25{iface}]` |
| [DataSourceScaleway.py:132](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/DataSourceScaleway.py#L132) | `http://` |
| [azure/errors.py:48](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/azure/errors.py#L48) | `https://aka.ms/linuxprovisioningerror` |
| [helpers/azure.py:692](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/helpers/azure.py#L692) | `http://{}/machine?comp=health` |
| [helpers/azure.py:799](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/helpers/azure.py#L799) | `http://{}/machine/?comp=goalstate` |
| [helpers/azure.py:972](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/helpers/azure.py#L972) | `http://schemas.dmtf.org/ovf/environment/1` |
| [helpers/azure.py:973](https://github.com/canonical/cloud-init/blob/2e29ad07daced32d3fac1cb2aa93b817fe12b291/cloudinit/sources/helpers/azure.py#L973) | `http://schemas.microsoft.com/windowsazure` |

## Interpretation

- Verify new candidates against current provider documentation before proposing a runtime policy change.
- This extraction is incomplete by design: aliases, calculated addresses and endpoints absent from cloud-init need separate research.
- Comments and docstrings are excluded; source string literals can still be false positives.
- IPv6 private ranges cannot all be blocked if LAN webhook destinations are intended to work. Review specific known metadata hosts alongside existing address-class checks.
- Hostname matching alone cannot prevent rebinding or redirects. Delivery still needs address validation and connection pinning.

See [tool instructions](../README.md) and [machine-readable snapshot](snapshot.json) for exact URL literals, reference details and per-file hashes.
